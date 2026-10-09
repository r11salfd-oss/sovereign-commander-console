import React from 'react';
import { Shield, Radio, Activity } from 'lucide-react';

interface SovereignLoadingHUDProps {
  label?: string;
  sublabel?: string;
}

export default function SovereignLoadingHUD({
  label = 'ACQUIRING NEURAL TELEMETRY STREAM',
  sublabel = 'CALIBRATING SOVEREIGN DEFENSE PROTOCOLS'
}: SovereignLoadingHUDProps) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center select-none">
      {/* Tactical Radar Spinner */}
      <div className="relative flex items-center justify-center mb-6">
        {/* Outer Pulsing Ring */}
        <div className="absolute h-24 w-24 rounded-full border border-cyan-500/20 animate-ping" />
        
        {/* Radar Ring with Rotating Sweep */}
        <div className="relative h-20 w-20 rounded-full border border-cyan-500/40 bg-slate-950/80 backdrop-blur-md flex items-center justify-center shadow-lg shadow-cyan-950/50">
          <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400 animate-spin" />
          <Shield className="h-8 w-8 text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
        </div>

        {/* Small Satellite Nodes */}
        <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-cyan-400 animate-pulse" />
        <div className="absolute -bottom-1 -left-1 h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
      </div>

      {/* Military Status Readout */}
      <div className="space-y-1.5 max-w-sm">
        <div className="flex items-center justify-center gap-2 text-cyan-400 font-mono text-xs font-bold tracking-widest uppercase">
          <Radio className="h-3.5 w-3.5 animate-pulse text-cyan-400" />
          <span>{label}</span>
        </div>
        <p className="text-[11px] font-mono text-slate-500 tracking-wider">
          {sublabel}
        </p>
      </div>

      {/* Real-time Crypto Metadata */}
      <div className="mt-4 pt-3 border-t border-slate-900/80 flex items-center gap-3 text-[10px] font-mono text-slate-600">
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3 text-cyan-600" />
          <span>SYNC: ACTIVE</span>
        </span>
        <span>•</span>
        <span>CHAIN: 360ea36c28e66d9d</span>
      </div>
    </div>
  );
}
