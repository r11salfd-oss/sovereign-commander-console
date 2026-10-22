/**
 * ====================================================================================================
 * SOVEREIGN ARSENAL INDEX
 * ====================================================================================================
 * Unified export point for all offensive and defensive security libraries
 * ====================================================================================================
 */

// Core
export { SovereignArsenalCore, arsenalCore } from './core/arsenal_core';
export type { ArsenalMode, SeverityLevel, OperationStatus, ArsenalConfig, OperationContext, AuditEntry, Finding } from './core/arsenal_core';

// Offensive
export { OffensiveArsenal, ReconnaissanceModule, ExploitationFramework, PostExploitationModule, PayloadGenerator } from './offensive/offensive_arsenal';
export type { ReconTarget, Vulnerability, Payload } from './offensive/offensive_arsenal';

// Defensive
export { DefensiveArsenal, HardeningModule, ThreatDetectionModule, IncidentResponseModule, ForensicsModule } from './defensive/defensive_arsenal';
export type { HardeningRule, ThreatIndicator, Alert, Incident } from './defensive/defensive_arsenal';

// Integrated Purple Team
export { IntegratedArsenal, PurpleTeamOrchestrator, integratedArsenal } from './integrated/purple_team';
export type { AdversaryEmulation, PurpleTeamExercise, ContinuousValidation } from './integrated/purple_team';

// Network
export { NetworkArsenal, PortScanner, PacketAnalyzer, NetworkMonitor, FirewallBypass, IDSIPS } from './network/network_arsenal';
export type { PortScanResult, NetworkInterface } from './network/network_arsenal';

// Web
export { WebArsenal, WebScanner, SQLInjectionScanner, XSSScanner, AuthBypass, APISecurity } from './web/web_arsenal';
export type { WebTarget } from './web/web_arsenal';

// Crypto
export { CryptoArsenal, CryptoAnalyzer, HashCracker, SSLAnalyzer, CertTools } from './crypto/crypto_arsenal';

// OSINT
export { OSINTArsenal, DomainRecon, EmailHarvester, SocialEngineer, MetadataExtractor } from './osint/osint_arsenal';
export type { OSINTResult } from './osint/osint_arsenal';

// Threat Intel
export { ThreatIntelArsenal, IOCCollector, ThreatFeed, MITREMapper, TTPAnalyzer } from './threat_intel/threat_intel_arsenal';
export type { IOC } from './threat_intel/threat_intel_arsenal';

// Secrets Scanner (Track C)
export { SecretsScanner, shannonEntropyString, maskSecretValue } from './secrets/secrets_scanner';
export type { SecretFinding, ScanOptions, ScanSummary, SecretsReport } from './secrets/secrets_scanner';

// AI Red Team (Track C)
export { AIRedTeam, maskSecretsInText, METHOD_NOTE } from './ai_redteam/ai_redteam';
export type { PromptInjectionResult, JailbreakResult, LeakageResult, ModelOutputScore, RedTeamPayload } from './ai_redteam/ai_redteam';

// Reverse Engineering (Track C)
export { ReverseEngineering } from './reverse/reverse_engineering';
export type { BinaryInfo, SectionInfo, ImportEntry, StringExtraction, FunctionCandidate, SuspiciousIndicator, ReverseAnalysisReport } from './reverse/reverse_engineering';

// Adversary Lab (Track C)
export { AdversaryLab } from './lab/adversary_lab';

// Automation
export { AutomationArsenal, WorkflowEngine, PlaybookExecutor, OrchestrationEngine } from './automation/automation_arsenal';
export type { Playbook } from './automation/automation_arsenal';

// Malware Analysis
export { MalwareAnalysisArsenal, StaticAnalysis, DynamicAnalysis, SandboxAnalyzer, YARARules } from './malware/malware_analysis_arsenal';
export type { MalwareSample, StaticAnalysisResult, DynamicAnalysisResult } from './malware/malware_analysis_arsenal';

// C2 Framework (Training Only)
export { C2Arsenal, C2Server, BeaconManager, Listener, PayloadDelivery } from './c2/c2_framework';
export type { Beacon, Task } from './c2/c2_framework';

// Reporting
export { ReportingArsenal, ReportGenerator, EvidenceManager, ChainOfCustodyManager } from './reporting/reporting_arsenal';
export type { Evidence, ChainOfCustody } from './reporting/reporting_arsenal';

// TTP Engine & Risk Scoring
export { TTPEngine, RiskScoring } from './core/ttp_engine';
export type { TTPCoverage, RiskAssessment } from './core/ttp_engine';

// Arsenal Commander - Unified Orchestrator
export { ArsenalCommander, arsenalCommander } from './commander/arsenal_commander';
export type { MissionType, CommanderConfig, CommanderResult, CommanderStep } from './commander/arsenal_commander';

// Tools
export { ArsenalUtils, ArsenalReportGenerator } from './tools/arsenal_utils';

// Main Arsenal
import { integratedArsenal } from './integrated/purple_team';
export default integratedArsenal;
