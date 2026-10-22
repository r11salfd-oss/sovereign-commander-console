/**
 * ====================================================================================================
 * ARSENAL TOOLS - UTILITY FUNCTIONS
 * ====================================================================================================
 * Helper utilities for the sovereign arsenal
 * ====================================================================================================
 */

import crypto from 'crypto';

export class ArsenalUtils {
    static generateId(prefix: string = 'ARS'): string {
        return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }
    
    static hashData(data: string | Buffer): string {
        const buf = typeof data === 'string' ? Buffer.from(data) : data;
        return crypto.createHash('sha256').update(buf).digest('hex');
    }
    
    static timestamp(): string {
        return new Date().toISOString();
    }
    
    static severityToScore(severity: string): number {
        const map: Record<string, number> = {
            'CRITICAL': 10, 'HIGH': 7.5, 'MEDIUM': 5, 'LOW': 2.5, 'INFO': 0
        };
        return map[severity] || 0;
    }
    
    static calculateRiskScore(findings: Array<{ severity: string }>): number {
        if (findings.length === 0) return 0;
        const total = findings.reduce((sum, f) => sum + this.severityToScore(f.severity), 0);
        return Math.min(10, total / findings.length * 2);
    }
    
    static sanitizeTarget(target: string): string {
        return target.replace(/[^a-zA-Z0-9.-]/g, '');
    }
    
    static formatBytes(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let size = bytes;
        while (size >= 1024 && i < 3) { size /= 1024; i++; }
        return `${size.toFixed(2)} ${units[i]}`;
    }
}

export class ArsenalReportGenerator {
    static generateReport(title: string, data: any): string {
        return JSON.stringify({
            title,
            generatedAt: new Date().toISOString(),
            ...data
        }, null, 2);
    }
    
    static htmlReport(title: string, findings: any[]): string {
        const findingsHtml = findings.map(f => `
            <tr>
                <td>${f.id}</td>
                <td>${f.title}</td>
                <td class="sev-${f.severity}">${f.severity}</td>
                <td>${f.description}</td>
            </tr>
        `).join('');
        
        return `<!DOCTYPE html><html><head><title>${title}</title>
        <style>body{font-family:monospace;background:#0a0a0a;color:#00ff88}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #333;padding:8px}
        .sev-CRITICAL{color:#ff0040}.sev-HIGH{color:#ff6b00}.sev-MEDIUM{color:#ffd700}.sev-LOW{color:#00ff88}
        </style></head><body><h1>${title}</h1><table>
        <tr><th>ID</th><th>Title</th><th>Severity</th><th>Description</th></tr>
        ${findingsHtml}</table></body></html>`;
    }
}

export default ArsenalUtils;
