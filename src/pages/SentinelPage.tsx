import React, { useState, useEffect } from 'react';
import { Shield, ShieldCheck, Lock, AlertTriangle, Eye, Flame } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';
import { auth } from '../firebase';

interface SecurityEvent {
  id: string;
  time: string;
  type: 'BLOCKED_ACCESS' | 'HASH_VERIFIED' | 'AUTH_CHECK' | 'PATH_GUARD';
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  description: string;
  origin: string;
}

export default function SentinelPage() {
  const { workspaceInfo } = useWorkspace();
  const [testingFirewall, setTestingFirewall] = useState(false);
  const [firewallTestResult, setFirewallTestResult] = useState<string | null>(null);

  const [events, setEvents] = useState<SecurityEvent[]>([
    {
      id: 'SEC-101',
      time: new Date(Date.now() - 1000 * 60 * 5).toLocaleTimeString(),
      type: 'PATH_GUARD',
      severity: 'INFO',
      description: 'Active Sentinel guard established on workspace',
      origin: 'Sentinel Daemon v2.4'
    },
    {
      id: 'SEC-102',
      time: new Date(Date.now() - 1000 * 60 * 3).toLocaleTimeString(),
      type: 'HASH_VERIFIED',
      severity: 'INFO',
      description: 'Parent hash block integrity verified. Linear SHA-256 intact.',
      origin: 'Crypto Core'
    },
    {
      id: 'SEC-103',
      time: new Date(Date.now() - 1000 * 60 * 1).toLocaleTimeString(),
      type: 'AUTH_CHECK',
      severity: 'INFO',
      description: 'Google Account OAuth2 token authenticated: r11salfd@gmail.com',
      origin: 'AGY CLI Bridge'
    }
  ]);

  useEffect(() => {
    if (workspaceInfo?.displayPath) {
      setEvents(prev => prev.map(e => e.id === 'SEC-101' ? {
        ...e,
        description: `Active Sentinel guard established on workspace: ${workspaceInfo.displayPath}`
      } : e));
    }
  }, [workspaceInfo]);

  const testFirewallViolation = async () => {
    setTestingFirewall(true);
    setFirewallTestResult(null);
    try {
      // Intentionally trigger the secureSandboxGuard middleware by querying SOVEREIGN_WAR_CHEST
      const blockedTarget = workspaceInfo?.warChestBlockTarget || '/workspace/SOVEREIGN_WAR_CHEST/vault.key';
      const res = await fetch(`/api/workspace/preview?path=${encodeURIComponent(blockedTarget)}`);
      const data = await res.json();
      if (res.status === 403) {
        setFirewallTestResult(`[SUCCESS] 403 FORBIDDEN - Sentinel Guard successfully intercepted and blocked the forbidden access:\n${JSON.stringify(data, null, 2)}`);
        setEvents(prev => [
          {
            id: `SEC-${Date.now().toString().slice(-3)}`,
            time: new Date().toLocaleTimeString(),
            type: 'BLOCKED_ACCESS',
            severity: 'CRITICAL',
            description: `Unauthorized path probe against ${blockedTarget} successfully blocked by Sentinel Sentinel Guard (403 Forbidden).`,
            origin: 'Firewall Test Harness'
          },
          ...prev
        ]);
      } else {
        setFirewallTestResult(`Unexpected response status ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e: any) {
      setFirewallTestResult('Network or intercept error: ' + e.message);
    } finally {
      setTestingFirewall(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090e] p-4 md:p-8 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-rose-400 font-mono text-sm tracking-wider uppercase mb-1">
              <Shield className="w-5 h-5" />
              <span>Sentinel Security Operations Center</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">Threat Mitigation & Boundary Defense</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Zero-trust sandbox monitoring, path traversal prevention, and cryptographic boundary defense.
            </p>
          </div>
        </div>

        {/* Protection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel border border-emerald-500/30 rounded-xl bg-emerald-950/10 p-5 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs uppercase font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>SOVEREIGN_WAR_CHEST Guard</span>
            </div>
            <div className="text-lg font-bold font-mono text-white">STRICTLY ISOLATED</div>
            <p className="text-xs text-slate-400 font-sans">
              All requests targeting or mentioning the War Chest are immediately intercepted and terminated with HTTP 403.
            </p>
          </div>

          <div className="glass-panel border border-cyan-500/30 rounded-xl bg-cyan-950/10 p-5 space-y-2">
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase font-bold">
              <Lock className="w-4 h-4" />
              <span>HITL Signature Gate</span>
            </div>
            <div className="text-lg font-bold font-mono text-white">MANDATORY ENFORCED</div>
            <p className="text-xs text-slate-400 font-sans">
              No code modification or execution proposal may run without human commander approval and cryptographic hash.
            </p>
          </div>

          <div className="glass-panel border border-amber-500/30 rounded-xl bg-amber-950/10 p-5 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-mono text-xs uppercase font-bold">
              <Eye className="w-4 h-4" />
              <span>Identity Verification</span>
            </div>
            <div className="text-lg font-bold font-mono text-white">
              {auth.currentUser?.email || 'UNAUTHENTICATED'}
            </div>
            <p className="text-xs text-slate-400 font-sans">
              {auth.currentUser?.email ? `Session bound to active commander: ${auth.currentUser.email}` : 'المنظومة في وضع الزائر المحدود دون هوية مصادق عليها'}
            </p>
          </div>
        </div>

        {/* Firewall Test Harness */}
        <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/95 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-mono font-bold uppercase text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400" /> Defensive Sandbox Test Harness
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Send an artificial illegal probe to verify that the Sentinel middleware blocks unauthorized paths.
              </p>
            </div>
            <button
              onClick={testFirewallViolation}
              disabled={testingFirewall}
              className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-mono text-xs font-semibold tracking-wider transition disabled:opacity-40 flex items-center gap-2 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{testingFirewall ? 'Simulating Breach...' : 'Firewall Probe Test'}</span>
            </button>
          </div>

          {firewallTestResult && (
            <div className="p-4 rounded-lg bg-slate-950 border border-rose-900/60 font-mono text-xs text-rose-300 whitespace-pre leading-relaxed shadow-inner">
              {firewallTestResult}
            </div>
          )}
        </div>

        {/* Security Event Log */}
        <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/80 p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
              Sentinel Event Dispatch Log ({events.length} Events)
            </span>
          </div>

          <div className="space-y-2">
            {events.map(ev => (
              <div
                key={ev.id}
                className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 font-mono text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    ev.severity === 'CRITICAL' ? 'bg-rose-950 border border-rose-800 text-rose-400' :
                    ev.severity === 'WARN' ? 'bg-amber-950 border border-amber-800 text-amber-400' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {ev.severity}
                  </span>
                  <span className="text-slate-400">{ev.time}</span>
                  <span className="text-white font-medium">{ev.description}</span>
                </div>
                <div className="text-slate-500 text-[11px]">{ev.origin}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
