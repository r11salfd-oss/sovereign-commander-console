/**
 * ====================================================================================================
 * TTP ENGINE + RISK SCORING
 * MITRE ATT&CK mapping from real Findings, unified 0-100 risk score, kill-chain derivation.
 * ====================================================================================================
 */

import { arsenalCore, Finding, SeverityLevel } from './arsenal_core';

export interface TTPCoverage {
    tactic: string;
    techniqueId: string;
    technique: string;
    subTechnique?: string;
    findings: Finding[];
    confidence: number;
}

export interface RiskAssessment {
    overallScore: number;
    overallSeverity: SeverityLevel;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    riskFactors: string[];
    recommendations: string[];
}

/**
 * Category -> MITRE ATT&CK mapping.
 * Keys are normalized (lowercase, non-alphanumeric -> underscore).
 */
const MITRE_MAP: Record<string, { tactic: string; techniqueId: string; technique: string }> = {
    open_port:             { tactic: 'Reconnaissance',     techniqueId: 'T1595', technique: 'Active Scanning' },
    sql_injection:         { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    xss:                   { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    auth_bypass:           { tactic: 'Initial Access',     techniqueId: 'T1078', technique: 'Valid Accounts' },
    weak_crypto:           { tactic: 'Credential Access',  techniqueId: 'T1557', technique: 'Adversary-in-the-Middle' },
    missing_patch:         { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    exposed_secret:        { tactic: 'Credential Access',  techniqueId: 'T1552', technique: 'Unsecured Credentials' },
    misconfiguration:      { tactic: 'Defense Evasion',    techniqueId: 'T1562', technique: 'Impair Defenses' },
    default_creds:         { tactic: 'Initial Access',     techniqueId: 'T1078', technique: 'Valid Accounts' },
    directory_traversal:   { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    file_upload:           { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    command_injection:     { tactic: 'Execution',          techniqueId: 'T1059', technique: 'Command and Scripting Interpreter' },
    privilege_escalation:  { tactic: 'Privilege Escalation', techniqueId: 'T1068', technique: 'Exploitation for Privilege Escalation' },
    lateral_movement:      { tactic: 'Lateral Movement',   techniqueId: 'T1021', technique: 'Remote Services' },
    data_exfiltration:     { tactic: 'Exfiltration',       techniqueId: 'T1041', technique: 'Exfiltration Over C2 Channel' },
    malware_indicator:     { tactic: 'Execution',          techniqueId: 'T1204', technique: 'User Execution' },
    prompt_injection:      { tactic: 'Initial Access',     techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    jailbreak:             { tactic: 'Defense Evasion',    techniqueId: 'T1562', technique: 'Impair Defenses' },
    data_leakage:          { tactic: 'Exfiltration',       techniqueId: 'T1041', technique: 'Exfiltration Over C2 Channel' },
    secret_exposure:       { tactic: 'Credential Access',  techniqueId: 'T1552', technique: 'Unsecured Credentials' },
    rate_limit_bypass:     { tactic: 'Impact',             techniqueId: 'T1499', technique: 'Endpoint Denial of Service' },
    missing_mfa:           { tactic: 'Initial Access',     techniqueId: 'T1078', technique: 'Valid Accounts' },
    insecure_deserialization: { tactic: 'Execution',       techniqueId: 'T1204', technique: 'User Execution' }
};

const TACTIC_ORDER = [
    'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution', 'Persistence',
    'Privilege Escalation', 'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement',
    'Collection', 'Command and Control', 'Exfiltration', 'Impact'
];

function normalize(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export class TTPEngine {
    static mapFinding(finding: Finding): TTPCoverage | null {
        const candidates = [normalize(finding.category), normalize(finding.title)];
        for (const c of candidates) {
            const mapping = MITRE_MAP[c];
            if (mapping) {
                return {
                    tactic: mapping.tactic,
                    techniqueId: mapping.techniqueId,
                    technique: mapping.technique,
                    findings: [finding],
                    confidence: finding.severity === 'CRITICAL' ? 0.95
                              : finding.severity === 'HIGH' ? 0.9
                              : finding.severity === 'MEDIUM' ? 0.8 : 0.7
                };
            }
        }
        return null;
    }

    static generateTTPMap(findings: Finding[]): TTPCoverage[] {
        const coverage = new Map<string, TTPCoverage>();
        for (const finding of findings) {
            const mapped = this.mapFinding(finding);
            if (!mapped) continue;
            const key = `${mapped.tactic}:${mapped.techniqueId}`;
            const existing = coverage.get(key);
            if (existing) {
                existing.findings.push(finding);
                existing.confidence = Math.min(1, existing.confidence + 0.05);
            } else {
                coverage.set(key, mapped);
            }
        }
        return Array.from(coverage.values()).sort((a, b) => b.findings.length - a.findings.length);
    }

    static getKillChain(coverage: TTPCoverage[]): string[] {
        const present = new Set(coverage.map(c => c.tactic));
        return TACTIC_ORDER.filter(t => present.has(t));
    }

    static unmapped(findings: Finding[]): Finding[] {
        return findings.filter(f => !this.mapFinding(f));
    }
}

export class RiskScoring {
    static calculate(findings: Finding[]): RiskAssessment {
        let critical = 0, high = 0, medium = 0, low = 0, info = 0;
        for (const f of findings) {
            switch (f.severity) {
                case 'CRITICAL': critical++; break;
                case 'HIGH': high++; break;
                case 'MEDIUM': medium++; break;
                case 'LOW': low++; break;
                default: info++;
            }
        }

        let score = critical * 10 + high * 7 + medium * 4 + low * 2 + info * 0.5;
        if (score > 100) score = 100;
        score = Math.round(score);

        let overallSeverity: SeverityLevel = 'INFO';
        if (score >= 80) overallSeverity = 'CRITICAL';
        else if (score >= 60) overallSeverity = 'HIGH';
        else if (score >= 30) overallSeverity = 'MEDIUM';
        else if (score >= 10) overallSeverity = 'LOW';

        const riskFactors: string[] = [];
        if (critical > 0) riskFactors.push(`${critical} CRITICAL finding(s) require immediate remediation`);
        if (high > 0) riskFactors.push(`${high} HIGH severity issue(s) detected`);
        if (findings.length > 10) riskFactors.push('Large attack surface: multiple findings across categories');
        if (critical === 0 && high === 0 && findings.length === 0) riskFactors.push('No findings recorded - assessment may not have executed real probes');

        const recommendations: string[] = [];
        if (critical > 0) recommendations.push('Remediate all CRITICAL findings before any deployment gate passes');
        if (high > 0) recommendations.push('Address HIGH severity issues within a 24-48h window');
        if (medium > 0) recommendations.push('Schedule MEDIUM severity remediation in the current sprint');
        if (findings.length === 0) recommendations.push('Re-run the assessment with reachable targets; empty result set indicates no probes executed');
        recommendations.push('Validate fixes by re-running the same mission and comparing TTP coverage');
        recommendations.push('Retain the evidence chain of custody for every recorded finding');

        arsenalCore.audit('RISK_ASSESSMENT', 'ttp-engine', 'SUCCESS', { score, overallSeverity, total: findings.length });

        return {
            overallScore: score,
            overallSeverity,
            critical, high, medium, low, info,
            riskFactors,
            recommendations
        };
    }
}

export default { TTPEngine, RiskScoring };
