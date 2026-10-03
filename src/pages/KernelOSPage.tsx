import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Layers, 
  HardDrive, 
  ShieldCheck, 
  Terminal, 
  Zap, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  Play, 
  Key, 
  FileText, 
  ArrowRight,
  Activity,
  Server
} from 'lucide-react';
import { 
  ACPITable, 
  InterruptDescriptor, 
  PageTableMapping, 
  KernelProcess, 
  SyscallEntry, 
  RingBufferFrame, 
  VfsNode, 
  SignedKernelModule, 
  EngineeringGapItem 
} from '../os/types';

export default function KernelOSPage() {
  const [activeTab, setActiveTab] = useState<'todo' | 'layer0' | 'layer1' | 'layer2' | 'layer3' | 'layer4'>('todo');
  const [loading, setLoading] = useState<boolean>(true);
  const [statusData, setStatusData] = useState<any>(null);
  const [gapItems, setGapItems] = useState<EngineeringGapItem[]>([]);
  const [bootData, setBootData] = useState<any>(null);
  const [idtEntries, setIdtEntries] = useState<InterruptDescriptor[]>([]);
  const [processes, setProcesses] = useState<KernelProcess[]>([]);
  const [syscalls, setSyscalls] = useState<SyscallEntry[]>([]);
  const [ringFrames, setRingFrames] = useState<RingBufferFrame[]>([]);
  const [vfsTree, setVfsTree] = useState<VfsNode[]>([]);
  const [signedModules, setSignedModules] = useState<SignedKernelModule[]>([]);

  // Interactive Form States
  const [testAddr, setTestAddr] = useState<string>('0xFFFFFFFF80100000');
  const [translatedAddr, setTranslatedAddr] = useState<PageTableMapping | null>(null);
  const [selectedSyscall, setSelectedSyscall] = useState<number>(1);
  const [selectedCaller, setSelectedCaller] = useState<string>('interface-agent');
  const [syscallResult, setSyscallResult] = useState<any>(null);
  const [newModuleName, setNewModuleName] = useState<string>('sov_mod_custom_guard.ko');
  const [newModuleAuthor, setNewModuleAuthor] = useState<string>('interface-agent');
  const [newModuleRing, setNewModuleRing] = useState<'RING_0_KERNEL' | 'RING_1_DRIVERS' | 'RING_2_SERVICES' | 'RING_3_USER'>('RING_0_KERNEL');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchKernelData = async () => {
    try {
      setLoading(true);
      const [
        resStatus,
        resGaps,
        resBoot,
        resIdt,
        resSched,
        resSys,
        resRing,
        resVfs,
        resSec
      ] = await Promise.all([
        fetch('/api/kernel/status').then(r => r.json()),
        fetch('/api/kernel/gap-matrix').then(r => r.json()),
        fetch('/api/kernel/boot-sequence').then(r => r.json()),
        fetch('/api/kernel/idt').then(r => r.json()),
        fetch('/api/kernel/scheduler').then(r => r.json()),
        fetch('/api/kernel/syscalls').then(r => r.json()),
        fetch('/api/kernel/ipc/ring-buffer').then(r => r.json()),
        fetch('/api/kernel/vfs/tree').then(r => r.json()),
        fetch('/api/kernel/security/modules').then(r => r.json())
      ]);

      setStatusData(resStatus);
      setGapItems(resGaps.items || []);
      setBootData(resBoot);
      setIdtEntries(resIdt.entries || []);
      setProcesses(resSched.processes || []);
      setSyscalls(resSys.syscalls || []);
      setRingFrames(resRing.frames || []);
      setVfsTree(resVfs.nodes || []);
      setSignedModules(resSec.modules || []);
    } catch (err) {
      console.error('Failed to load kernel data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKernelData();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchKernelData();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleTranslate = async () => {
    try {
      const res = await fetch('/api/kernel/mmu/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ virtualAddress: testAddr })
      });
      const data = await res.json();
      if (data.ok) {
        setTranslatedAddr(data.mapping);
        setActionNotice(`MMU 4-Level Paging: Address ${testAddr} successfully mapped to Physical Frame ${data.mapping.physicalFrame}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTriggerException = async (vector: number) => {
    try {
      const res = await fetch('/api/kernel/idt/trigger-exception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vector })
      });
      const data = await res.json();
      if (data.ok) {
        setActionNotice(`Vector ${vector} (${data.name}) intercepted: ${data.actionTaken}`);
        fetchKernelData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePreemptScheduler = async () => {
    try {
      const res = await fetch('/api/kernel/scheduler/preempt', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setActionNotice('Scheduler Quantum Dispatched: Context switch completed across Sovereign Council processes.');
        setProcesses(data.processes);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleInvokeSyscall = async () => {
    try {
      const res = await fetch('/api/kernel/syscall/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syscallNumber: selectedSyscall,
          callerAgent: selectedCaller,
          payload: { command: 'VERIFY_RING_ISOLATION', timestamp: Date.now() }
        })
      });
      const data = await res.json();
      setSyscallResult(data);
      setActionNotice(data.result);
      fetchKernelData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSignModule = async () => {
    try {
      const res = await fetch('/api/kernel/security/sign-module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newModuleName,
          authorAgent: newModuleAuthor,
          targetRing: newModuleRing
        })
      });
      const data = await res.json();
      if (data.ok) {
        /* CORRECTION (sweep — NOT on the audit list, and this was the single most
           misleading string on the page). It previously read:
             `Kernel Module ${name} cryptographically signed with Ed25519 &
              mapped to ${addr}`
           Three false claims in one operator-facing toast:
             (a) "cryptographically signed" — nothing was signed. The "signature"
                 is `Math.random()` (see kernelEngine.ts `signModule`).
             (b) "with Ed25519"  — no Ed25519 key pair exists in this codebase.
             (c) "mapped to <addr>" — no module was loaded and no address was
                 mapped. `loadAddress` is synthesised from an array index
                 (`this.signedModules.length * 0x10000`).
           The toast still reports that the action completed and still names the
           module and the address, because the operator does need to know a record
           was created — but it can no longer be mistaken for a load event. */
      setActionNotice(`Module record created (NOT signed, NOT loaded): ${data.module.name} — "signature" is ${data.module.signatureEd25519}, loadAddress ${data.module.loadAddress} is a synthetic label, status "${data.module.status}" is hardcoded`);
        setSignedModules(prev => [data.module, ...prev]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRebootKernel = async () => {
    try {
      const res = await fetch('/api/kernel/boot/reboot', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setActionNotice(data.message);
        fetchKernelData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-200 p-4 md:p-8 font-sans">
      {/* Header Banner */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl border border-cyan-500/30 bg-gradient-to-r from-slate-950 via-[#0a1324] to-[#070d18] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="space-y-1 relative z-10">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-700/60 font-mono text-[10px] uppercase font-bold tracking-widest">
                ENG-AUDIT-DEEP-091 COMPLIANCE
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/60 font-mono text-[10px] uppercase font-bold">
                {/* CORRECTION (audit finding): was `100% GAPS RESOLVED`.
                    No closure ratio is computed anywhere on this path. `gapItems`
                    is a static array of 10 literals, each carrying a hardcoded
                    `status: 'VERIFIED'` (kernelEngine.ts:513-603). Nothing measures
                    whether a gap is closed, nothing counts how many are closed, and
                    there is no denominator — the percentage had no referent.
                    `100%` also reads as a completeness claim about the gap list
                    itself, which is equally unsupported: the list's completeness is
                    whatever ENG-AUDIT-DEEP-091 happened to enumerate.
                    Replaced with the count that IS observable (the size of the
                    declared list) plus an explicit statement that no closure
                    measurement exists. No new number was invented. */}
                {gapItems.length} GAPS DECLARED — NOT VERIFIED CLOSED
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700/60 font-mono text-[10px] uppercase">
                COUNCIL MEMBER 8 ACTIVE
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-white font-mono tracking-tight flex items-center gap-2">
              <Cpu className="w-6 h-6 text-cyan-400" />
              Sovereign OS Kernel & Low-Level Architecture Cockpit
            </h1>
            <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
              {/* CORRECTION (sweep). The word "متكاملة" (fully integrated) asserted that these
                  layers are actually joined into a working operating system. They are
                  in-process JavaScript data structures and template literals in
                  kernelEngine.ts: no bootloader runs, no MMU or IDT is programmed, no
                  ring buffer carries traffic between processes, no VFS mounts anything,
                  and no ring separation is enforced. The layer NAMES are all real and
                  all retained — they describe what the cockpit documents, which is the
                  truthful claim. Only the integration claim was removed. */}
              منظومة تشغيل سيادية موثَّقة من الطبقة الصفرية (Firmware/Bootloader) إلى نواة المعالجة (Kernel/MMU/IDT)، وناقل الاتصال فائق السرعة (Zero-Copy Ring IPC)، وصولاً إلى نظام الملفات الشجري (VFS) ومصفوفة العزل التشفيري (Ring 0/Ring 3). هذه الطبقات موصوفة وممثَّلة داخل العملية، وليست نظام تشغيل مادياً قيد التشغيل.
            </p>
          </div>

          <div className="flex items-center gap-3 relative z-10 shrink-0">
            <button
              onClick={handleRebootKernel}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-700/60 hover:bg-rose-900/60 text-rose-300 text-xs font-mono font-bold transition shadow-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>دورة إقلاع عتادية</span>
            </button>
            <button
              onClick={fetchKernelData}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-950/60 border border-cyan-600/60 hover:bg-cyan-900/60 text-cyan-300 text-xs font-mono font-bold transition shadow-lg cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 animate-spin" />
              <span>مزامنة القياسات</span>
            </button>
          </div>
        </div>

        {/* Global Live Registers Bar */}
        {statusData && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 font-mono text-[11px]">
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">CR0 (PE+PG)</span>
              <span className="text-emerald-400 font-bold truncate">{statusData.cpuRegisters?.cr0}</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">CR3 (PML4 BASE)</span>
              <span className="text-cyan-400 font-bold truncate">{statusData.cpuRegisters?.cr3}</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">RIP (KERNEL ENTRY)</span>
              <span className="text-purple-400 font-bold truncate">{statusData.cpuRegisters?.rip}</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">RSP (RING 0 STACK)</span>
              <span className="text-amber-400 font-bold truncate">{statusData.cpuRegisters?.rsp}</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">IDT VECTORS</span>
              <span className="text-cyan-300 font-bold">{statusData.idtVectorsCount} / 256 Active</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">RTOS PROCESSES</span>
              <span className="text-emerald-300 font-bold">{statusData.processCount} Members (8 Agents)</span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col">
              <span className="text-slate-500 text-[9px]">MAC SECURITY</span>
              <span className="text-rose-400 font-bold truncate">{statusData.securityStatus}</span>
            </div>
          </div>
        )}

        {actionNotice && (
          <div className="mt-3 p-3 rounded-lg bg-cyan-950/60 border border-cyan-500/50 text-cyan-200 text-xs font-mono flex items-center justify-between animate-fadeIn">
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
              {actionNotice}
            </span>
            <button 
              onClick={() => setActionNotice(null)} 
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="max-w-7xl mx-auto mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide border-b border-slate-800">
        <button
          onClick={() => setActiveTab('todo')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'todo'
              ? 'bg-slate-900 text-amber-300 border-amber-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-amber-400" />
          <span>مصفوفة إنجاز الفجوات (Master Gap Matrix)</span>
          <span className="ml-1 px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 text-[10px] border border-amber-800">10/10</span>
        </button>

        <button
          onClick={() => setActiveTab('layer0')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'layer0'
              ? 'bg-slate-900 text-cyan-300 border-cyan-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Server className="w-4 h-4 text-cyan-400" />
          <span>Layer 0: Firmware & Bootstrap</span>
        </button>

        <button
          onClick={() => setActiveTab('layer1')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'layer1'
              ? 'bg-slate-900 text-emerald-300 border-emerald-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Cpu className="w-4 h-4 text-emerald-400" />
          <span>Layer 1: Kernel Core & MMU Paging</span>
        </button>

        <button
          onClick={() => setActiveTab('layer2')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'layer2'
              ? 'bg-slate-900 text-purple-300 border-purple-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Zap className="w-4 h-4 text-purple-400" />
          <span>Layer 2: IPC & Syscall Gates</span>
        </button>

        <button
          onClick={() => setActiveTab('layer3')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'layer3'
              ? 'bg-slate-900 text-blue-300 border-blue-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <HardDrive className="w-4 h-4 text-blue-400" />
          <span>Layer 3: VFS & Sovereign Storage</span>
        </button>

        <button
          onClick={() => setActiveTab('layer4')}
          className={`px-4 py-2.5 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'layer4'
              ? 'bg-slate-900 text-rose-300 border-rose-400 shadow-md'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-rose-400" />
          <span>Layer 4: Security & Module Signing</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto">
        {/* TAB 1: MASTER GAP MATRIX (TODO LIST) */}
        {activeTab === 'todo' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h2 className="text-base font-bold text-amber-300 font-mono flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-400" />
                  قائمة معالجة وإغلاق الفجوات الهندسية (ENG-AUDIT-DEEP-091 ToDo Matrix)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {/* CORRECTION (audit finding): was "تم إغلاق كافة الفجوات
                      الهندسية العشر ... ونقل النظام بالكامل من الحاوية المجردة إلى
                      معمارية نظام تشغيل سيادي متكامل" — "ALL TEN engineering gaps
                      were closed, and the system was moved ENTIRELY from the
                      abstract container to a fully integrated sovereign OS
                      architecture." Three unsupported claims:
                      (a) "كافة" (all) — no closure measurement exists;
                      (b) "تم إغلاق" (were closed) — each row's 'VERIFIED' is a
                          hardcoded literal, not a verification result;
                      (c) "بالكامل" (entirely) — a total-migration claim.
                      What is true and is now the whole sentence: the ten gaps
                      were enumerated and each has a written engineering solution
                      on record. The claims of closure and of completed migration
                      are not measurable from this page. */}
                  فُحصت الفجوات الهندسية العشر المذكورة في تقرير التدقيق المعمق، ولكلٍّ منها حلٌّ هندسي موثَّق في السجل. لم يُقَس إغلاق أي فجوة ولم يُتحقق منه، ولم يُقَس مدى انتقال النظام من الحاوية إلى بنية نظام تشغيل.
                </p>
              </div>
              <div className="text-right">
                {/* CORRECTION (audit finding): was `100% COMPLETE` over
                    `10 VERIFIED ARTIFACTS`. See the header badge above: no
                    closure ratio is computed and the 'VERIFIED' per-row status
                    is a literal. The artifact COUNT is a real observable, so the
                    count is kept and only the false qualifiers are removed. */}
                <span className="text-xl font-bold font-mono text-slate-300">CLOSURE NOT MEASURED</span>
                <div className="text-[10px] text-slate-500 font-mono">{gapItems.length} DECLARED GAP ITEMS — NO VERIFICATION PERFORMED</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {gapItems.map(item => (
                <div 
                  key={item.id} 
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] font-bold">
                        {item.id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                        {item.layer}
                      </span>
                      <h3 className="text-sm font-bold text-white font-mono">{item.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-slate-400">المشرف:</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[10px] font-bold">
                        {item.assignedAgent}
                      </span>
                      {/* CORRECTION (sweep). This badge rendered the literal string `VERIFIED` in
                          emerald green with a check icon, for every one of the ten
                          rows. `item.status` comes from `gapAuditItems` in
                          kernelEngine.ts:513-603, where all ten entries carry a
                          hardcoded `status: 'VERIFIED'`. No verification is performed
                          on this path, so the green tick was the loudest false
                          signal on the page.
                          The literal is still shown — hiding it would destroy the
                          information that the field EXISTS and what it currently
                          says — but it is no longer dressed as a passed check, and
                          it is explicitly attributed to the declared record rather
                          than to a measurement. `status` and `item.status` are kept
                          because the value genuinely is part of the data model. */}
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px] font-bold">
                        DECLARED STATUS: {item.status} (hardcoded — not verified)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded bg-rose-950/20 border border-rose-900/30">
                      <div className="text-[10px] font-mono text-rose-400 font-bold mb-1">الفجوة المشخصة في التقرير:</div>
                      <p className="text-slate-300 leading-relaxed">{item.gapDescription}</p>
                    </div>

                    <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-900/30">
                      <div className="text-[10px] font-mono text-emerald-400 font-bold mb-1">الحل الهندسي المنفذ:</div>
                      <p className="text-slate-300 leading-relaxed">{item.engineeringSolution}</p>
                    </div>
                  </div>

                  <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px] font-mono">
                    {/* CORRECTION (sweep). The label read "الأثر البرمجي الموثق (Verified Artifact)".
                      "موثق" / "Verified" asserts that an artifact was produced and
                      checked. No artifact exists: all ten `verifiedArtifact` strings
                      are hand-written declarations in kernelEngine.ts, and they have
                      been restated to say so explicitly (they formerly cited EFI
                      binaries, CPU registers, ACPI tables and a "0.4µs avg latency"
                      that were never built, written or measured).
                      The VALUE is still rendered — the operator needs to see what the
                      record claims — but it is no longer presented as a verified
                      finding. The colour was dropped from cyan to slate for the same
                      reason: cyan-bold read as a confirmed result. */}
                    <span className="text-slate-500">سجل الأثر المعلن — غير مُتحقق منه (Declared Artifact Record — NOT verified):</span>
                    <span className="text-slate-300 font-mono truncate max-w-xl">{item.verifiedArtifact}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: LAYER 0 - FIRMWARE & BOOTSTRAP */}
        {activeTab === 'layer0' && bootData && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {bootData.stages?.map((st: any, idx: number) => (
                <div 
                  key={st.stage} 
                  className={`p-3 rounded-xl border flex flex-col justify-between ${
                    st.status === 'ACTIVE' 
                      ? 'bg-cyan-950/40 border-cyan-500 text-white' 
                      : 'bg-slate-900/60 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-slate-500">STAGE {idx + 1}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                      st.status === 'ACTIVE' ? 'bg-cyan-500 text-black' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    }`}>
                      {st.status}
                    </span>
                  </div>
                  <div className="text-xs font-mono font-bold text-cyan-300 mb-1">{st.stage}</div>
                  <div className="text-[10px] text-slate-400 mb-2 leading-tight">{st.desc}</div>
                  <div className="text-[9px] font-mono text-slate-500 pt-2 border-t border-slate-800 truncate">
                    ADDR: {st.address}
                  </div>
                </div>
              ))}
            </div>

            {/* ACPI Tables */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  جداول الـ ACPI 2.0+ (Advanced Configuration and Power Interface)
                </h3>
                <span className="text-xs font-mono text-slate-500">RSDP / XSDT 64-bit Compliant</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {bootData.acpiTables?.map((tbl: ACPITable) => (
                  <div key={tbl.signature} className="p-3 rounded-lg border border-slate-800 bg-slate-950 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800">
                        {tbl.signature}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">Rev {tbl.revision} • {tbl.length}B</span>
                    </div>
                    <div className="text-[11px] text-slate-300 font-sans">{tbl.description}</div>
                    <div className="pt-2 border-t border-slate-900 space-y-1 font-mono text-[10px]">
                      {Object.entries(tbl.parsedFields).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-slate-400">
                          <span>{k}:</span>
                          <span className="text-cyan-300 font-bold">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Device Tree Blob (DTB) */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                شجرة العتاد الفيزيائي (Device Tree Blobs - DTB)
              </h3>
              <div className="p-3 rounded-lg bg-black font-mono text-xs text-purple-300 border border-slate-800 overflow-x-auto">
                <pre>{JSON.stringify(bootData.deviceTree, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LAYER 1 - KERNEL ARCHITECTURE & MMU */}
        {activeTab === 'layer1' && (
          <div className="space-y-6">
            {/* MMU 4-Level Paging Calculator */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    مترجم ومحلل الذاكرة الافتراضية (4-Level MMU Paging Engine)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    تحليل العنوان الافتراضي (48-bit Canonical Virtual Address) إلى: PML4 (9b) → PDPT (9b) → PD (9b) → PT (9b) → Offset (12b).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={testAddr}
                    onChange={e => setTestAddr(e.target.value)}
                    className="px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500 w-56"
                    placeholder="0xFFFFFFFF80100000"
                  />
                  <button
                    onClick={handleTranslate}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-black font-mono text-xs font-bold transition cursor-pointer"
                  >
                    ترجمة العنوان
                  </button>
                </div>
              </div>

              {translatedAddr && (
                <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">PML4 INDEX</div>
                      <div className="text-sm font-bold text-cyan-400">{translatedAddr.pml4Index}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">PDPT INDEX</div>
                      <div className="text-sm font-bold text-purple-400">{translatedAddr.pdptIndex}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">PD INDEX</div>
                      <div className="text-sm font-bold text-blue-400">{translatedAddr.pdIndex}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">PT INDEX</div>
                      <div className="text-sm font-bold text-emerald-400">{translatedAddr.ptIndex}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">PHYSICAL FRAME</div>
                      <div className="text-sm font-bold text-amber-300 truncate">{translatedAddr.physicalFrame}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[10px] pt-2 border-t border-slate-900">
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      Present: {translatedAddr.flags.present ? 'TRUE (1)' : 'FALSE (0)'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      Writable: {translatedAddr.flags.writable ? 'TRUE (1)' : 'FALSE (0)'}
                    </span>
                    <span className={`px-2 py-0.5 rounded border ${
                      translatedAddr.flags.userAccessible 
                        ? 'bg-amber-950 text-amber-300 border-amber-800' 
                        : 'bg-rose-950 text-rose-300 border-rose-800'
                    }`}>
                      Privilege: {translatedAddr.flags.userAccessible ? 'Ring 3 (User Space)' : 'Ring 0 (Supervisor Only)'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                      NX (No-Execute): {translatedAddr.flags.noExecute ? 'ENABLED (1)' : 'DISABLED (0)'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Preemptive RTOS Process Scheduler */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    جدولة العمليات في الوقت الحقيقي (Preemptive RTOS Priority Scheduler)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    إدارة كوانتم التنفيذ لوكلاء المجلس السيادي مع فرض حدود cgroups v2 الصارمة.
                  </p>
                </div>
                <button
                  onClick={handlePreemptScheduler}
                  className="px-3 py-1.5 rounded bg-cyan-900/60 hover:bg-cyan-800/80 text-cyan-200 border border-cyan-700/60 font-mono text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 text-cyan-400" />
                  <span>توليد نبضة الجدولة (Preempt Quantum)</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">PID</th>
                      <th className="p-2.5">PROCESS NAME</th>
                      <th className="p-2.5">AGENT MAPPING</th>
                      <th className="p-2.5">PRIORITY</th>
                      <th className="p-2.5">PRIVILEGE RING</th>
                      <th className="p-2.5">STATE</th>
                      <th className="p-2.5">QUANTUM</th>
                      <th className="p-2.5">CGROUPS V2 (CPU / MEM)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/20">
                    {processes.map(p => (
                      <tr key={p.pid} className="hover:bg-slate-800/30 transition">
                        <td className="p-2.5 text-slate-500 font-bold">{p.pid}</td>
                        <td className="p-2.5 text-white font-bold">{p.name}</td>
                        <td className="p-2.5 text-cyan-300">{p.agentId}</td>
                        <td className="p-2.5 text-amber-400 font-bold">{p.priority}</td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            p.ring === 'RING_0_KERNEL' 
                              ? 'bg-rose-950 text-rose-300 border border-rose-800' 
                              : p.ring === 'RING_1_DRIVERS'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}>
                            {p.ring}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            p.state === 'RUNNING' ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {p.state}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-400">{p.cpuQuantumMs}ms ({p.cpuTimeUsedMs}ms total)</td>
                        <td className="p-2.5 text-slate-400">
                          {p.cgroups.cpuMaxPercent}% CPU • {p.cgroups.memMaxMb}MB MAX
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interrupt Descriptor Table (IDT) */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    جدول واصفات المقاطعات (Interrupt Descriptor Table - 256 Vectors)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    إدارة الأعطال العتادية ومقاطعات الساعة واستدعاءات النظام عبر بوابة INT 0x80.
                  </p>
                </div>
                <span className="text-xs font-mono text-emerald-400 font-bold">256 Vectors Active</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
                {idtEntries.map(e => (
                  <div key={e.vector} className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] font-bold">
                        VEC {e.vector} (0x{e.vector.toString(16).toUpperCase()})
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                        e.type === 'FAULT' ? 'bg-rose-950 text-rose-300' : e.type === 'SOFTWARE_SYSCALL' ? 'bg-purple-950 text-purple-300' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {e.type}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-white mb-2">{e.name}</div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900 text-[10px] font-mono">
                      <span className="text-slate-500">DPL: Ring {e.dpl} • {e.invocationCount} hits</span>
                      <button
                        onClick={() => handleTriggerException(e.vector)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition cursor-pointer"
                      >
                        اختبار الإرسال
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LAYER 2 - IPC & SYSCALL GATES */}
        {activeTab === 'layer2' && (
          <div className="space-y-6">
            {/* Interactive Syscall Invocation */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-purple-400" />
                    بوابة استدعاءات النظام السيادية (Sovereign Syscall Interface)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    تنفيذ النداءات عبر البوابة التشفيرية من مساحة المستخدم (Ring 3) إلى النواة (Ring 0).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">رقم النداء (Syscall Number)</label>
                  <select
                    value={selectedSyscall}
                    onChange={e => setSelectedSyscall(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none"
                  >
                    {syscalls.map(s => (
                      <option key={s.number} value={s.number}>
                        0x{s.number.toString(16).padStart(2, '0')}: {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">الوكيل الطالب (Caller Agent)</label>
                  <select
                    value={selectedCaller}
                    onChange={e => setSelectedCaller(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none"
                  >
                    <option value="interface-agent">interface-agent (Member 8)</option>
                    <option value="developer-agent">developer-agent</option>
                    <option value="sentinel-agent">sentinel-agent</option>
                    <option value="orchestrator-agent">orchestrator-agent</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleInvokeSyscall}
                    className="w-full py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>تنفيذ النداء في النواة</span>
                  </button>
                </div>
              </div>

              {syscallResult && (
                <div className="p-3 rounded bg-slate-950 border border-purple-900/50 font-mono text-xs text-purple-200">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>EXECUTION RESULT</span>
                    {/* CORRECTION (sweep — NOT on the audit list, found by reading
                        the producer of this number before trusting the label).
                        This previously read `LATENCY: {syscallResult.latencyUs}µs`,
                        presenting a microsecond figure as a measurement.
                        It is not one. `executeSyscall` (kernelEngine.ts:665) computes
                        `latency = Number((Math.random() * 0.8 + 0.3).toFixed(2))` —
                        a random number in the range 0.30–1.10 µs, drawn fresh on every
                        call. Nothing is timed; there is no hrtime, no clock read and no
                        comparison before/after. A latency shown in µs invites an operator
                        to believe a microkernel dispatch was profiled.
                        The generator itself is in a file whose owner may not change data
                        flow, so it was NOT rewritten to perform a real timing. The label is
                        corrected instead, so the number can no longer be read as a
                        measurement. See the governance report for the escalated fix.
                        The value is still rendered — deleting it would destroy information
                        — but it is now labelled as synthetic and its range is stated. */}
                    <span title="رقم مُركَّب عشوائياً (Math.random) في executeSyscall — ليس قياساً زمنياً">
                      LATENCY (SYNTHETIC, NOT MEASURED): {syscallResult.latencyUs}µs
                    </span>
                  </div>
                  <div>{syscallResult.result}</div>
                </div>
              )}

              {/* Syscalls Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">NUM</th>
                      <th className="p-2.5">NAME & SIGNATURE</th>
                      <th className="p-2.5">REQUIRED RING</th>
                      <th className="p-2.5">DESCRIPTION</th>
                      <th className="p-2.5">TOTAL INVOCATIONS</th>
                      <th className="p-2.5">LATENCY</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/20">
                    {syscalls.map(s => (
                      <tr key={s.number} className="hover:bg-slate-800/30 transition">
                        <td className="p-2.5 text-cyan-400 font-bold">0x{s.number.toString(16).padStart(2, '0')}</td>
                        <td className="p-2.5">
                          <div className="font-bold text-white">{s.name}</div>
                          <div className="text-[10px] text-slate-500">{s.signature}</div>
                        </td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            s.requiredRing === 'RING_0_KERNEL' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'
                          }`}>
                            {s.requiredRing}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-400 text-[11px]">{s.description}</td>
                        <td className="p-2.5 text-amber-300 font-bold">{s.totalCalls}</td>
                        <td className="p-2.5 text-slate-400">{s.lastLatencyUs}µs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Zero-Copy Shared Memory Ring Buffer */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    ناقل الذاكرة المشتركة فائق السرعة (Zero-Copy Ring Buffer IPC)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    مصفوفة حلقية خالية من الأقفال (Lock-free Ring Buffer) في الذاكرة الفيزيائية 0xFFFFC90000000000 بسعة 1MB لتبادل الإطارات بدون نسخ.
                  </p>
                </div>
                <span className="text-xs font-mono text-cyan-300 font-bold">&lt; 1.0µs Ultra Latency</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {ringFrames.slice(0, 6).map(f => (
                  <div key={f.id} className="p-3 rounded bg-slate-950 border border-slate-800 font-mono text-xs space-y-1.5">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-cyan-400 font-bold">{f.id}</span>
                      <span className="text-slate-500">{new Date(f.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-amber-300 truncate">{f.sourceAgent}</span>
                      <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="text-purple-300 truncate">{f.targetAgent}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-900 flex justify-between">
                      <span>PTR: {f.zeroCopyPointer}</span>
                      <span className="text-emerald-400 font-bold">{f.payloadSize}B</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: LAYER 3 - VFS & SOVEREIGN STORAGE */}
        {activeTab === 'layer3' && (
          <div className="space-y-6">
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-blue-400" />
                    شجرة نظام الملفات الافتراضية السيادية (Sovereign VFS Hierarchy)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    دعم مسارات /sys/sov/ لإعدادات الوكلاء و /dev/cmd/ لعقد الإدخال/الإخراج ومخزن /sov/vault/ المحمي.
                  </p>
                </div>
                <span className="text-xs font-mono text-blue-400 font-bold">Journaling POSIX Active</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {vfsTree.map(node => (
                  <div key={node.path} className="p-3.5 rounded-lg border border-slate-800 bg-slate-950 font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          node.type === 'DIRECTORY' ? 'bg-blue-950 text-blue-300' : node.type === 'CHAR_DEV' || node.type === 'BLOCK_DEV' ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {node.type}
                        </span>
                        <span className="text-white font-bold">{node.path}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">{node.permissions}</span>
                    </div>

                    {node.content && (
                      <div className="p-2 rounded bg-black/60 text-slate-300 text-[11px] truncate">
                        {node.content}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                      <span>Owner: {node.owner} • {node.sizeBytes}B</span>
                      <span className="text-emerald-400 font-bold">Journaled: YES</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: LAYER 4 - SECURITY & MODULE SIGNING */}
        {activeTab === 'layer4' && (
          <div className="space-y-6">
            {/* Module Signer Interface */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Key className="w-4 h-4 text-rose-400" />
                    {/* CORRECTION (sweep — NOT on the audit list). This heading
                        said "(Kernel Module Signing Lab - Ed25519)". No Ed25519 key
                        pair and no asymmetric operation exists anywhere in this
                        codebase. The panel still performs a signing-lab ACTION and
                        that action is preserved below; only the false algorithm
                        attribution is removed. */}
                    مختبر تسجيل وحدات النواة (Kernel Module Signing Lab — UNSIGNED, no Ed25519)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {/* CORRECTION (sweep). The previous sentence read "التحقق الإلزامي
                        من التوقيع الرقمي (Mandatory Access Control) قبل حجز أي صفحة في
                        فضاء النواة" — "mandatory signature verification before
                        allocating any page in kernel address space". Nothing verifies
                        any signature and nothing gates any allocation: pressing the
                        button calls /api/kernel/sign-module, which stores a record whose
                        "signature" is Math.random() (kernelEngine.ts `signModule`) with a
                        hardcoded `status: 'VERIFIED_ACTIVE'`. No page is allocated, no
                        access is checked, no enforcement point exists. Describing it as
                        "mandatory" and as a control implied a security boundary that
                        this code does not implement. */}
                    هذا الإجراء يسجّل قيماً فقط ولا يفرض أي قيد: لا يوجد أي تحقّق من توقيع،
                    ولا يوجد أي فحص صلاحية، ولا تُحجز أي صفحة ذاكرة. الحقل المسمّى
                    «توقيع» ليس توقيعاً بل سلسلة عشوائية، والحالة المعلنة ثابتة في الشيفرة.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">اسم الوحدة (.ko)</label>
                  <input
                    type="text"
                    value={newModuleName}
                    onChange={e => setNewModuleName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">الوكيل الموقع</label>
                  <input
                    type="text"
                    value={newModuleAuthor}
                    onChange={e => setNewModuleAuthor(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">مستوى الحماية المستهدف</label>
                  <select
                    value={newModuleRing}
                    onChange={e => setNewModuleRing(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-rose-300 font-mono focus:outline-none"
                  >
                    <option value="RING_0_KERNEL">Ring 0 (Supervisor Kernel)</option>
                    <option value="RING_1_DRIVERS">Ring 1 (Device Drivers)</option>
                    <option value="RING_2_SERVICES">Ring 2 (System Services)</option>
                    <option value="RING_3_USER">Ring 3 (User Land)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleSignModule}
                    className="w-full py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>توقيع وتحميل الوحدة</span>
                  </button>
                </div>
              </div>

              {/* Signed Modules List */}
              <div className="space-y-3 pt-3">
                <h4 className="text-xs font-bold text-slate-300 font-mono uppercase">الوحدات النمطية المحملة والموقعة في النواة:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {signedModules.map(m => (
                    <div key={m.sha256Hash} className="p-3.5 rounded-lg border border-slate-800 bg-slate-950 font-mono text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white truncate max-w-[180px]">{m.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 text-[9px] border border-rose-800">
                          {m.targetRing}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex justify-between">
                        <span>الوكيل: {m.authorAgent}</span>
                        {/* CORRECTION (sweep). This rendered the word `VERIFIED` in
                            emerald for every signed module. Nothing verifies these
                            modules: `status: 'VERIFIED_ACTIVE'` is hardcoded in
                            kernelEngine.ts (line 692 for modules created by
                            `signModule`, lines 475/486/497 for the three seeded
                            literals), and the accompanying "signature" is either
                            `Math.random()` or a hardcoded string. `status` itself is
                            NOT renamed because the union
                            `'VERIFIED_ACTIVE' | 'REVOKED' | 'QUARANTINED'` is
                            declared in src/os/types.ts, which this owner may not
                            edit. So the declared status is still displayed, but it
                            is no longer presented as a passed verification. */}
                        <span className="text-amber-400 font-bold" title="hardcoded status literal — no signature was verified">
                          {m.status} (declared — not verified)
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900 text-[9px] text-slate-400 truncate">
                        {/* CORRECTION: was `SIG: {m.signatureEd25519}`. The field is
                            named `signatureEd25519` in src/os/types.ts (not this
                            owner's file), but its value is prefixed `unsigned-random:`
                            for freshly "signed" modules and `unsigned-literal:` for
                            the three seeded ones. There is no Ed25519 key pair and no
                            asymmetric operation in this codebase. Labelling the line
                            `SIG` invited the reader to treat it as a signature. */}
                        NOT-A-SIGNATURE (unsigned): {m.signatureEd25519}
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                        <span>ADDR: {m.loadAddress}</span>
                        <span>{m.sizeBytes}B</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
