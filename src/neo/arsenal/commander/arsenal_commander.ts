/**
 * ====================================================================================================
 * ARSENAL COMMANDER - UNIFIED OPERATIONS ORCHESTRATOR
 * Turns the arsenal from a set of libraries into one coordinated operations platform.
 * ====================================================================================================
 */

import { arsenalCore, OperationContext, Finding } from '../core/arsenal_core';
import { NetworkArsenal } from '../network/network_arsenal';
import { WebArsenal } from '../web/web_arsenal';
import { OffensiveArsenal } from '../offensive/offensive_arsenal';
import { DefensiveArsenal } from '../defensive/defensive_arsenal';
import { OSINTArsenal } from '../osint/osint_arsenal';
import { ThreatIntelArsenal } from '../threat_intel/threat_intel_arsenal';
import { ReportingArsenal } from '../reporting/reporting_arsenal';
import { TTPEngine, RiskScoring, TTPCoverage, RiskAssessment } from '../core/ttp_engine';

export type MissionType =
    | 'FULL_RECON'
    | 'QUICK_SCAN'
    | 'WEB_ASSESS'
    | 'PURPLE_EXERCISE'
    | 'HARDENING_AUDIT'
    | 'THREAT_HUNT'
    | 'COMPREHENSIVE_ASSESS';

export interface CommanderConfig {
    mission: MissionType;
    target?: string;
    scope: string[];
    auth: string;
    autoChain?: string[];
    autoReport?: boolean;
    collectEvidence?: boolean;
    mapTTP?: boolean;
}

export interface CommanderStep {
    step: string;
    status: 'START' | 'COMPLETE' | 'SKIPPED' | 'FAILED';
    detail?: string;
    timestamp: number;
}

export interface CommanderResult {
    success: boolean;
    operationId: string;
    mission: MissionType;
    durationMs: number;
    modulesExecuted: string[];
    modulesSkipped: string[];
    findings: Finding[];
    findingDelta: number;
    ttpCoverage: TTPCoverage[];
    unmappedFindings: Finding[];
    killChain: string[];
    riskAssessment: RiskAssessment;
    report?: any;
    evidenceIds: string[];
    auditTrail: number;
    timeline: CommanderStep[];
    error?: string;
}

export class ArsenalCommander {
    private timeline: CommanderStep[] = [];

    private log(step: string, status: CommanderStep['status'], detail?: string) {
        this.timeline.push({ step, status, detail, timestamp: Date.now() });
    }

    async run(config: CommanderConfig): Promise<CommanderResult> {
        const start = Date.now();
        this.timeline = [];
        this.log('MISSION_INIT', 'START', config.mission);

        const before = arsenalCore.getFindings().length;
        const modulesExecuted: string[] = [];
        const modulesSkipped: string[] = [];
        let evidenceIds: string[] = [];
        let report: any = null;

        let op: OperationContext;
        try {
            op = arsenalCore.createOperation('PURPLE', config.scope, config.target, config.auth);
        } catch (e: any) {
            this.log('CREATE_OPERATION', 'FAILED', e.message);
            arsenalCore.audit('COMMANDER_MISSION_FAILED', 'commander', 'FAILED', { error: e.message });
            return this.failure(config, '', start, modulesExecuted, modulesSkipped, evidenceIds, e.message);
        }
        this.log('CREATE_OPERATION', 'COMPLETE', op.operationId);

        const reporting = new ReportingArsenal(op);
        const chain = config.autoChain && config.autoChain.length
            ? config.autoChain
            : this.getDefaultChain(config.mission);
        this.log('AUTO_CHAIN', 'START', chain.join(', '));

        try {
            if (chain.includes('OSINT')) {
                if (!config.target) { this.log('OSINT', 'SKIPPED', 'no target'); modulesSkipped.push('OSINTArsenal'); }
                else {
                    this.log('OSINT', 'START');
                    const osint = new OSINTArsenal(op);
                    await osint.domain.whois(config.target);
                    await osint.domain.dnsEnum(config.target);
                    await osint.domain.subdomainEnum(config.target);
                    modulesExecuted.push('OSINTArsenal');
                    this.log('OSINT', 'COMPLETE');
                }
            }

            if (chain.includes('NETWORK')) {
                if (!config.target) { this.log('NETWORK', 'SKIPPED', 'no target'); modulesSkipped.push('NetworkArsenal'); }
                else {
                    this.log('NETWORK', 'START');
                    const net = new NetworkArsenal(op);
                    await net.scanner.tcpConnectScan(config.target, [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080, 8443]);
                    modulesExecuted.push('NetworkArsenal');
                    this.log('NETWORK', 'COMPLETE');
                }
            }

            if (chain.includes('WEB')) {
                if (!config.target) { this.log('WEB', 'SKIPPED', 'no target'); modulesSkipped.push('WebArsenal'); }
                else {
                    this.log('WEB', 'START');
                    const web = new WebArsenal(op);
                    const base = config.target.startsWith('http') ? config.target : `http://${config.target}`;
                    await web.scanner.crawl({ url: base });
                    await web.scanner.directoryBrute({ url: base });
                    modulesExecuted.push('WebArsenal');
                    this.log('WEB', 'COMPLETE');
                }
            }

            if (chain.includes('THREAT_INTEL')) {
                this.log('THREAT_INTEL', 'START');
                const intel = new ThreatIntelArsenal(op);
                intel.mitre.getTactics();
                modulesExecuted.push('ThreatIntelArsenal');
                this.log('THREAT_INTEL', 'COMPLETE');
            }

            if (chain.includes('OFFENSIVE')) {
                this.log('OFFENSIVE', 'START');
                new OffensiveArsenal(op);
                modulesExecuted.push('OffensiveArsenal');
                this.log('OFFENSIVE', 'COMPLETE');
            }

            if (chain.includes('DEFENSIVE')) {
                this.log('DEFENSIVE', 'START');
                new DefensiveArsenal(op);
                modulesExecuted.push('DefensiveArsenal');
                this.log('DEFENSIVE', 'COMPLETE');
            }

            const findings = arsenalCore.getFindings();
            const findingDelta = findings.length - before;
            this.log('FINDINGS_COLLECTED', 'COMPLETE', `${findingDelta} new`);

            let ttpCoverage: TTPCoverage[] = [];
            let unmapped: Finding[] = [];
            if (config.mapTTP !== false) {
                ttpCoverage = TTPEngine.generateTTPMap(findings);
                unmapped = TTPEngine.unmapped(findings);
                this.log('TTP_MAPPING', 'COMPLETE', `${ttpCoverage.length} techniques, ${unmapped.length} unmapped`);
            }

            const riskAssessment = RiskScoring.calculate(findings);
            this.log('RISK_SCORING', 'COMPLETE', `${riskAssessment.overallScore}/100 ${riskAssessment.overallSeverity}`);

            if (config.collectEvidence !== false) {
                const payload = Buffer.from(JSON.stringify({
                    mission: config.mission,
                    operationId: op.operationId,
                    newFindings: findingDelta,
                    ttpTechniques: ttpCoverage.length,
                    riskScore: riskAssessment.overallScore
                }));
                const ev = reporting.evidence.collect('artifact', payload, `Commander mission evidence - ${config.mission}`);
                reporting.custody.createChain(ev.id);
                evidenceIds.push(ev.id);
                this.log('EVIDENCE_COLLECTION', 'COMPLETE', ev.id);
            }

            if (config.autoReport !== false) {
                report = reporting.reports.generateTechnicalReport(findings);
                report.commander = {
                    mission: config.mission,
                    modulesExecuted,
                    modulesSkipped,
                    findingDelta,
                    ttpCoverage,
                    unmappedFindings: unmapped.map(f => f.id),
                    killChain: TTPEngine.getKillChain(ttpCoverage),
                    riskAssessment,
                    durationMs: Date.now() - start
                };
                this.log('REPORT_GENERATION', 'COMPLETE');
            }

            this.log('MISSION_COMPLETE', 'COMPLETE');
            arsenalCore.audit('COMMANDER_MISSION_COMPLETE', 'commander', 'SUCCESS', {
                mission: config.mission, operationId: op.operationId, newFindings: findingDelta
            });

            return {
                success: true,
                operationId: op.operationId,
                mission: config.mission,
                durationMs: Date.now() - start,
                modulesExecuted,
                modulesSkipped,
                findings,
                findingDelta,
                ttpCoverage,
                unmappedFindings: unmapped,
                killChain: TTPEngine.getKillChain(ttpCoverage),
                riskAssessment,
                report,
                evidenceIds,
                auditTrail: arsenalCore.getAuditLog().length,
                timeline: this.timeline
            };
        } catch (error: any) {
            this.log('ERROR', 'FAILED', error.message);
            arsenalCore.audit('COMMANDER_MISSION_FAILED', 'commander', 'FAILED', { error: error.message });
            return this.failure(config, op.operationId, start, modulesExecuted, modulesSkipped, evidenceIds, error.message);
        }
    }

    private failure(
        config: CommanderConfig, operationId: string, start: number,
        modulesExecuted: string[], modulesSkipped: string[], evidenceIds: string[], error: string
    ): CommanderResult {
        const findings = arsenalCore.getFindings();
        return {
            success: false,
            operationId,
            mission: config.mission,
            durationMs: Date.now() - start,
            modulesExecuted,
            modulesSkipped,
            findings,
            findingDelta: 0,
            ttpCoverage: [],
            unmappedFindings: [],
            killChain: [],
            riskAssessment: RiskScoring.calculate(findings),
            report: null,
            evidenceIds,
            auditTrail: arsenalCore.getAuditLog().length,
            timeline: this.timeline,
            error
        };
    }

    getDefaultChain(mission: MissionType): string[] {
        switch (mission) {
            case 'FULL_RECON':            return ['OSINT', 'NETWORK', 'WEB', 'THREAT_INTEL'];
            case 'QUICK_SCAN':            return ['NETWORK'];
            case 'WEB_ASSESS':            return ['NETWORK', 'WEB'];
            case 'PURPLE_EXERCISE':       return ['OSINT', 'NETWORK', 'WEB', 'OFFENSIVE', 'DEFENSIVE', 'THREAT_INTEL'];
            case 'HARDENING_AUDIT':       return ['DEFENSIVE', 'THREAT_INTEL'];
            case 'THREAT_HUNT':           return ['THREAT_INTEL', 'DEFENSIVE'];
            case 'COMPREHENSIVE_ASSESS':  return ['OSINT', 'NETWORK', 'WEB', 'OFFENSIVE', 'DEFENSIVE', 'THREAT_INTEL'];
            default:                      return ['OSINT', 'NETWORK'];
        }
    }

    getStatus() {
        return {
            name: 'ArsenalCommander',
            status: 'OPERATIONAL',
            capabilities: ['AUTO_CHAIN', 'TTP_MAPPING', 'RISK_SCORING', 'AUTO_REPORT', 'EVIDENCE_COLLECTION'],
            missions: this.getDefaultChain.length ? [
                'FULL_RECON', 'QUICK_SCAN', 'WEB_ASSESS', 'PURPLE_EXERCISE',
                'HARDENING_AUDIT', 'THREAT_HUNT', 'COMPREHENSIVE_ASSESS'
            ] : [],
            integratedModules: ['OSINT', 'NETWORK', 'WEB', 'OFFENSIVE', 'DEFENSIVE', 'THREAT_INTEL', 'REPORTING']
        };
    }
}

export const arsenalCommander = new ArsenalCommander();
export default arsenalCommander;
