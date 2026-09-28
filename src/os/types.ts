// Sovereign OS Kernel Engine - Types & Definitions
// Reference: ENG-AUDIT-DEEP-091

export type CpuRing = 'RING_0_KERNEL' | 'RING_1_DRIVERS' | 'RING_2_SERVICES' | 'RING_3_USER';

export type BootStage = 'REAL_MODE_16' | 'PROTECTED_MODE_32' | 'LONG_MODE_64' | 'UEFI_SECURE_INIT' | 'SOVEREIGN_CORE_ACTIVE';

export interface ACPITable {
  signature: string;
  oemId: string;
  tableId: string;
  revision: number;
  length: number;
  description: string;
  parsedFields: Record<string, string | number>;
}

export interface DeviceTreeNode {
  name: string;
  compatible: string[];
  reg?: string;
  status: 'okay' | 'disabled';
  properties: Record<string, any>;
  children?: DeviceTreeNode[];
}

export interface InterruptDescriptor {
  vector: number;
  name: string;
  type: 'FAULT' | 'TRAP' | 'ABORT' | 'HARDWARE_IRQ' | 'SOFTWARE_SYSCALL';
  handler: string;
  dpl: number; // Descriptor Privilege Level (0 for Ring 0 only, 3 for user accessible like 0x80)
  present: boolean;
  invocationCount: number;
  lastFired?: string;
}

export interface PageTableMapping {
  virtualAddress: string;
  physicalFrame: string;
  pml4Index: number;
  pdptIndex: number;
  pdIndex: number;
  ptIndex: number;
  flags: {
    present: boolean;
    writable: boolean;
    userAccessible: boolean;
    noExecute: boolean;
    writeThrough: boolean;
  };
}

export interface KernelProcess {
  pid: number;
  name: string;
  agentId: string;
  priority: number; // 0 to 99 (RTOS high priority)
  ring: CpuRing;
  state: 'READY' | 'RUNNING' | 'BLOCKED' | 'PREEMPTED';
  cpuQuantumMs: number;
  cpuTimeUsedMs: number;
  memoryPages: number;
  virtualBaseAddress: string;
  cgroups: {
    cpuMaxPercent: number;
    memMaxMb: number;
  };
}

export interface SyscallEntry {
  number: number;
  name: string;
  signature: string;
  requiredRing: CpuRing;
  description: string;
  totalCalls: number;
  lastLatencyUs: number;
}

export interface RingBufferFrame {
  id: string;
  sourceAgent: string;
  targetAgent: string;
  syscallNum: number;
  payloadSize: number;
  checksum: string;
  timestamp: string;
  zeroCopyPointer: string;
  processed: boolean;
}

export interface VfsNode {
  path: string;
  name: string;
  type: 'DIRECTORY' | 'FILE' | 'CHAR_DEV' | 'BLOCK_DEV' | 'SYS_CHANNEL';
  sizeBytes: number;
  permissions: string;
  owner: string;
  content?: string;
  journaled: boolean;
  sha256?: string;
}

export interface SignedKernelModule {
  name: string;
  version: string;
  targetRing: CpuRing;
  authorAgent: string;
  sha256Hash: string;
  signatureEd25519: string;
  status: 'VERIFIED_ACTIVE' | 'REVOKED' | 'QUARANTINED';
  loadAddress: string;
  sizeBytes: number;
}

export interface EngineeringGapItem {
  id: string;
  layer: 'Layer 0' | 'Layer 1' | 'Layer 2' | 'Layer 3' | 'Layer 4';
  title: string;
  gapDescription: string;
  engineeringSolution: string;
  assignedAgent: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'VERIFIED';
  verifiedArtifact: string;
}
