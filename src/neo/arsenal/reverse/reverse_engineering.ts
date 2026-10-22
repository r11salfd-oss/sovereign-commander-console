/**
 * ====================================================================================================
 * REVERSE ENGINEERING ARSENAL - STATIC BINARY STRUCTURE ANALYSIS
 * Standard: Diamond Standard (v3.0-HARDENED)
 *
 * Every value returned by this module is derived from REAL bytes read from a REAL file on disk.
 * Nothing is templated, nothing is invented:
 *
 *  - identify()          parses the real DOS/COFF/Optional headers, the real ELF header, the real
 *                        Mach-O header, or honestly reports 'UNKNOWN' with the first 16 bytes.
 *  - parseSections()     walks the real section table and computes Shannon entropy over the real
 *                        section bytes.
 *  - extractStrings()    pulls printable ASCII and UTF-16LE runs out of the real buffer, keeping
 *                        the true byte offsets.
 *  - parseImports()      walks the real PE import descriptors / the real ELF dynamic table and the
 *                        real PLT relocations. When a format exposes no import table the result is
 *                        an EMPTY array plus an explicit reason - never a fabricated DLL name.
 *  - findFunctions()     scans the real executable sections for real prologue byte patterns and
 *                        labels every hit as a HEURISTIC candidate.
 *  - detectSuspiciousIndicators() runs real byte-level checks (entropy, packer section names, PDB
 *                        path, URLs, IPv4 literals, crypto constants, embedded MZ, W+X sections).
 *  - analyze()           combines all of the above and records findings through arsenalCore.
 *
 * The module NEVER executes the analysed binary.
 * ====================================================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { arsenalCore, OperationContext, Finding, SeverityLevel } from '../core/arsenal_core';
import { shannonEntropy } from '../malware/malware_analysis_arsenal';

export type BinaryFormat = 'PE' | 'ELF' | 'MACHO' | 'JAVA_CLASS' | 'DOTNET' | 'WASM' | 'UNKNOWN';

export interface SectionInfo {
    name: string;
    virtualAddress: number;
    virtualSize: number;
    rawOffset: number;
    rawSize: number;
    entropy: number;
    /** Raw format-specific flag word (PE characteristics / ELF sh_flags). */
    characteristics: number;
    /** Human readable decoded flags, e.g. ['READ','WRITE','EXECUTE']. */
    flags: string[];
    writable: boolean;
    executable: boolean;
    /** ELF section type name (SHT_*) when applicable. */
    type?: string;
    /** ELF sh_entsize when applicable. */
    entsize?: number;
    /** Real anomaly labels derived from the bytes (HIGH_ENTROPY, ZERO_RAW_SIZE, ...). */
    anomalies: string[];
}

export interface ImportEntry {
    /** Real DLL name (PE) or DT_NEEDED soname (ELF). */
    library: string;
    /** Real imported symbol names resolved from the Import Name Table / dynsym. */
    symbols: string[];
    /** Which real structure produced this entry. */
    source: 'PE_IMPORT_DESCRIPTOR' | 'ELF_DT_NEEDED' | 'ELF_PLT_RELOC' | 'ELF_UNDEFINED_SYMBOL';
    /** Set when the import was made by ordinal rather than by name. */
    ordinal?: number;
}

export interface SymbolInfo {
    name: string;
    value: number;
    size: number;
    /** STB_* binding decoded from st_info. */
    bind: string;
    /** STT_* type decoded from st_info. */
    type: string;
}

export interface FunctionCandidate {
    /** Real file offset of the matched prologue. */
    offset: number;
    /** Identifier of the byte pattern that matched. */
    pattern: string;
    architecture: 'x86-64' | 'x86' | 'arm64';
    /** The 16 real bytes following the prologue, hex encoded. */
    bytesHex: string;
    /** Always 'LOW' - these are heuristics, not confirmed symbols. */
    confidence: 'LOW';
    /** Explicit marker so consumers cannot mistake this for a confirmed function. */
    heuristic: true;
}

export interface SuspiciousIndicator {
    type: string;
    severity: SeverityLevel;
    detail: string;
    offset?: number;
}

export interface BinaryInfo {
    filePath: string;
    fileSize: number;
    sha256: string;
    md5: string;
    format: BinaryFormat;
    /** First 16 bytes of the file, hex encoded (always populated, even for UNKNOWN). */
    firstBytesHex: string;
    /** Set when a recognised container could not be fully parsed. */
    parseError?: string;
    /** True when a .NET CLR header is present in the PE data directory. */
    isDotNet: boolean;
    pe?: PeHeaderInfo;
    elf?: ElfHeaderInfo;
    macho?: MachoHeaderInfo;
    java?: JavaClassInfo;
    wasm?: WasmInfo;
    /** Real dynamic symbols parsed from .dynsym (ELF) when available. */
    symbols?: SymbolInfo[];
}

export interface PeHeaderInfo {
    dosSignature: string;
    eLfanew: number;
    peSignature: string;
    machine: number;
    machineName: string;
    numberOfSections: number;
    timestamp: number;
    timestampIso: string;
    sizeOfOptionalHeader: number;
    characteristics: number;
    characteristicFlags: string[];
    optionalMagic: number;
    optionalMagicName: string;
    addressOfEntryPoint: number;
    imageBase: number;
    sectionAlignment: number;
    fileAlignment: number;
    subsystem: number;
    subsystemName: string;
    dllCharacteristics: number;
    dllCharacteristicFlags: string[];
    dataDirectories: Array<{ index: number; name: string; virtualAddress: number; size: number }>;
    /** True when the real CLR data directory (index 14) is populated. */
    isDotNet: boolean;
}

export interface ElfProgramHeader {
    index: number;
    type: number;
    typeName: string;
    flags: number;
    offset: number;
    vaddr: number;
    filesz: number;
    memsz: number;
    align: number;
}

export interface ElfHeaderInfo {
    class: 32 | 64;
    endianness: 'little' | 'big';
    type: number;
    typeName: string;
    machine: number;
    machineName: string;
    entry: number;
    phoff: number;
    shoff: number;
    phnum: number;
    shnum: number;
    shstrndx: number;
    programHeaders: ElfProgramHeader[];
}

export interface MachoSegment {
    name: string;
    vmaddr: number;
    vmsize: number;
    fileoff: number;
    filesize: number;
    nsects: number;
    maxprot: number;
    initprot: number;
}

export interface MachoHeaderInfo {
    magic: string;
    cputype: number;
    cpusubtype: number;
    filetype: number;
    ncmds: number;
    sizeofcmds: number;
    flags: number;
    segments: MachoSegment[];
    dylibs: string[];
}

export interface JavaClassInfo {
    minorVersion: number;
    majorVersion: number;
}

export interface WasmInfo {
    version: number;
}

export interface ImportResolution {
    imports: ImportEntry[];
    resolved: boolean;
    format: BinaryFormat;
    /** Explicit reason when the import table could not be resolved. Never a fabricated value. */
    reason: string;
}

export interface StringHit {
    offset: number;
    length: number;
    text: string;
    encoding: 'ASCII' | 'UTF16LE';
}

export interface StringExtraction {
    strings: StringHit[];
    count: number;
    minLength: number;
    truncated: boolean;
}

export interface ReverseAnalysisReport {
    filePath: string;
    fileSize: number;
    sha256: string;
    md5: string;
    format: BinaryFormat;
    identify: BinaryInfo;
    sections: SectionInfo[];
    strings: StringExtraction;
    imports: ImportResolution;
    functions: FunctionCandidate[];
    indicators: SuspiciousIndicator[];
    /** Real 0-100 score derived from the indicators that were actually observed. */
    score: number;
    findings: Finding[];
    analyzedAt: number;
}

// ------------------------------------------------------------------------------------------------
// Constant tables (decoded from the real specification, used to decode real header fields)
// ------------------------------------------------------------------------------------------------

const PE_MACHINE: Record<number, string> = {
    0x014c: 'IMAGE_FILE_MACHINE_I386',
    0x0166: 'IMAGE_FILE_MACHINE_R4000',
    0x0169: 'IMAGE_FILE_MACHINE_WCEMIPSV2',
    0x01a2: 'IMAGE_FILE_MACHINE_SH3',
    0x01a3: 'IMAGE_FILE_MACHINE_SH3DSP',
    0x01a6: 'IMAGE_FILE_MACHINE_SH4',
    0x01a8: 'IMAGE_FILE_MACHINE_SH5',
    0x01c0: 'IMAGE_FILE_MACHINE_ARM',
    0x01c2: 'IMAGE_FILE_MACHINE_THUMB',
    0x01c4: 'IMAGE_FILE_MACHINE_ARMNT',
    0x01d3: 'IMAGE_FILE_MACHINE_AM33',
    0x01f0: 'IMAGE_FILE_MACHINE_POWERPC',
    0x01f1: 'IMAGE_FILE_MACHINE_POWERPCFP',
    0x0200: 'IMAGE_FILE_MACHINE_IA64',
    0x0266: 'IMAGE_FILE_MACHINE_MIPS16',
    0x0284: 'IMAGE_FILE_MACHINE_ALPHA64',
    0x0366: 'IMAGE_FILE_MACHINE_MIPSFPU',
    0x0466: 'IMAGE_FILE_MACHINE_MIPSFPU16',
    0x0520: 'IMAGE_FILE_MACHINE_TRICORE',
    0x0ebc: 'IMAGE_FILE_MACHINE_EBC',
    0x8664: 'IMAGE_FILE_MACHINE_AMD64',
    0x9041: 'IMAGE_FILE_MACHINE_M32R',
    0xaa64: 'IMAGE_FILE_MACHINE_ARM64',
    0xc0ee: 'IMAGE_FILE_MACHINE_CEEF'
};

const PE_SUBSYSTEM: Record<number, string> = {
    0: 'IMAGE_SUBSYSTEM_UNKNOWN',
    1: 'IMAGE_SUBSYSTEM_NATIVE',
    2: 'IMAGE_SUBSYSTEM_WINDOWS_GUI',
    3: 'IMAGE_SUBSYSTEM_WINDOWS_CUI',
    5: 'IMAGE_SUBSYSTEM_OS2_CUI',
    7: 'IMAGE_SUBSYSTEM_POSIX_CUI',
    9: 'IMAGE_SUBSYSTEM_WINDOWS_CE_GUI',
    10: 'IMAGE_SUBSYSTEM_EFI_APPLICATION',
    11: 'IMAGE_SUBSYSTEM_EFI_BOOT_SERVICE_DRIVER',
    12: 'IMAGE_SUBSYSTEM_EFI_RUNTIME_DRIVER',
    13: 'IMAGE_SUBSYSTEM_EFI_ROM',
    14: 'IMAGE_SUBSYSTEM_XBOX',
    16: 'IMAGE_SUBSYSTEM_WINDOWS_BOOT_APPLICATION'
};

const PE_DATA_DIRECTORY_NAMES = [
    'Export', 'Import', 'Resource', 'Exception', 'Certificate', 'BaseRelocation',
    'Debug', 'Architecture', 'GlobalPtr', 'TLS', 'LoadConfig', 'BoundImport',
    'IAT', 'DelayImport', 'CLR', 'Reserved'
];

const PE_CHARACTERISTICS: Array<[number, string]> = [
    [0x0001, 'RELOCS_STRIPPED'], [0x0002, 'EXECUTABLE_IMAGE'], [0x0004, 'LINE_NUMS_STRIPPED'],
    [0x0008, 'LOCAL_SYMS_STRIPPED'], [0x0020, 'LARGE_ADDRESS_AWARE'], [0x0100, 'BYTES_REVERSED_LO'],
    [0x0200, '32BIT_MACHINE'], [0x0400, 'DEBUG_STRIPPED'], [0x0800, 'REMOVABLE_RUN_FROM_SWAP'],
    [0x1000, 'NET_RUN_FROM_SWAP'], [0x2000, 'SYSTEM'], [0x4000, 'DLL'], [0x8000, 'UP_SYSTEM_ONLY']
];

const PE_DLL_CHARACTERISTICS: Array<[number, string]> = [
    [0x0020, 'HIGH_ENTROPY_VA'], [0x0040, 'DYNAMIC_BASE'], [0x0080, 'FORCE_INTEGRITY'],
    [0x0100, 'NX_COMPAT'], [0x0200, 'NO_ISOLATION'], [0x0400, 'NO_SEH'],
    [0x0800, 'NO_BIND'], [0x1000, 'APPCONTAINER'], [0x2000, 'WDM_DRIVER'],
    [0x4000, 'GUARD_CF'], [0x8000, 'TERMINAL_SERVER_AWARE']
];

const PE_SECTION_CHARACTERISTICS: Array<[number, string]> = [
    [0x00000020, 'CODE'], [0x00000040, 'INITIALIZED_DATA'], [0x00000080, 'UNINITIALIZED_DATA'],
    [0x02000000, 'MEM_DISCARDABLE'], [0x04000000, 'MEM_NOT_CACHED'], [0x08000000, 'MEM_NOT_PAGED'],
    [0x10000000, 'MEM_SHARED'], [0x20000000, 'MEM_EXECUTE'], [0x40000000, 'MEM_READ'],
    [0x80000000, 'MEM_WRITE']
];

const ELF_TYPES: Record<number, string> = {
    0: 'ET_NONE', 1: 'ET_REL', 2: 'ET_EXEC', 3: 'ET_DYN', 4: 'ET_CORE'
};

const ELF_MACHINES: Record<number, string> = {
    0: 'EM_NONE', 2: 'EM_SPARC', 3: 'EM_386', 8: 'EM_MIPS', 20: 'EM_PPC', 21: 'EM_PPC64',
    22: 'EM_S390', 40: 'EM_ARM', 42: 'EM_SH', 43: 'EM_SPARCV9', 50: 'EM_IA_64',
    62: 'EM_X86_64', 183: 'EM_AARCH64', 243: 'EM_RISCV', 258: 'EM_LOONGARCH'
};

const ELF_PT_TYPES: Record<number, string> = {
    0: 'PT_NULL', 1: 'PT_LOAD', 2: 'PT_DYNAMIC', 3: 'PT_INTERP', 4: 'PT_NOTE',
    5: 'PT_SHLIB', 6: 'PT_PHDR', 7: 'PT_TLS', 0x6474e550: 'PT_GNU_EH_FRAME',
    0x6474e551: 'PT_GNU_STACK', 0x6474e552: 'PT_GNU_RELRO', 0x6474e553: 'PT_GNU_PROPERTY'
};

const ELF_SHT_TYPES: Record<number, string> = {
    0: 'SHT_NULL', 1: 'SHT_PROGBITS', 2: 'SHT_SYMTAB', 3: 'SHT_STRTAB', 4: 'SHT_RELA',
    5: 'SHT_HASH', 6: 'SHT_DYNAMIC', 7: 'SHT_NOTE', 8: 'SHT_NOBITS', 9: 'SHT_REL',
    10: 'SHT_SHLIB', 11: 'SHT_DYNSYM', 14: 'SHT_INIT_ARRAY', 15: 'SHT_FINI_ARRAY',
    0x6ffffff6: 'SHT_GNU_HASH', 0x6ffffffd: 'SHT_GNU_verdef', 0x6ffffffe: 'SHT_GNU_verneed',
    0x6fffffff: 'SHT_GNU_versym'
};

const ELF_SHF: Array<[number, string]> = [
    [0x1, 'WRITE'], [0x2, 'ALLOC'], [0x4, 'EXECINSTR'], [0x10, 'MERGE'], [0x20, 'STRINGS'],
    [0x40, 'INFO_LINK'], [0x80, 'LINK_ORDER'], [0x200, 'GROUP'], [0x400, 'TLS']
];

const MACHO_CPUTYPES: Record<number, string> = {
    7: 'CPU_TYPE_X86', 0x01000007: 'CPU_TYPE_X86_64', 12: 'CPU_TYPE_ARM', 0x0100000c: 'CPU_TYPE_ARM64',
    18: 'CPU_TYPE_POWERPC', 0x01000012: 'CPU_TYPE_POWERPC64'
};

const MACHO_FILETYPES: Record<number, string> = {
    1: 'MH_OBJECT', 2: 'MH_EXECUTE', 3: 'MH_FVMLIB', 4: 'MH_CORE', 5: 'MH_PRELOAD',
    6: 'MH_DYLIB', 7: 'MH_DYLINKER', 8: 'MH_BUNDLE', 9: 'MH_DYLIB_STUB', 10: 'MH_DSYM'
};

const MACHO_LC: Record<number, string> = {
    0x1: 'LC_SEGMENT', 0x2: 'LC_SYMTAB', 0xb: 'LC_DYSYMTAB', 0xc: 'LC_LOAD_DYLIB',
    0xd: 'LC_ID_DYLIB', 0x19: 'LC_SEGMENT_64', 0x1d: 'LC_ID_DYLINKER', 0x20: 'LC_LAZY_LOAD_DYLIB',
    0x22: 'LC_DYLD_INFO', 0x80000022: 'LC_DYLD_INFO_ONLY', 0x26: 'LC_FUNCTION_STARTS',
    0x27: 'LC_DYLD_ENVIRONMENT', 0x32: 'LC_BUILD_VERSION', 0x80000028: 'LC_MAIN'
};

/** Section names commonly produced by well-known packers. */
const PACKER_SECTION_NAMES = ['UPX0', 'UPX1', 'UPX2', '.themida', '.vmp0', '.vmp1', '.aspack', '.petite', '.nsp0', '.packed'];

/** Common crypto constants that are meaningful when found verbatim in a binary. */
const CRYPTO_CONSTANTS: Array<{ name: string; bytes: number[]; detail: string }> = [
    { name: 'AES_SBOX', bytes: [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5], detail: 'AES forward S-box prefix (63 7c 77 7b f2 6b 6f c5) - custom AES implementation' },
    { name: 'TEA_DELTA', bytes: [0xb9, 0x79, 0x37, 0x9e], detail: 'TEA/XTEA golden-ratio delta 0x9e3779b9 (little-endian)' },
    { name: 'TEA_DELTA_BE', bytes: [0x9e, 0x37, 0x79, 0xb9], detail: 'TEA/XTEA golden-ratio delta 0x9e3779b9 (big-endian)' },
    { name: 'RC4_SBOX_START', bytes: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], detail: 'RC4-style identity permutation prefix' },
    { name: 'SHA256_K0', bytes: [0x42, 0x8a, 0x2f, 0x98], detail: 'SHA-256 round constant K[0] 0x428a2f98 (little-endian)' },
    { name: 'MD5_T1', bytes: [0x78, 0xa4, 0x6a, 0xd7], detail: 'MD5 T-table constant 0xd76aa478 (little-endian)' }
];

/** Function prologue byte patterns. These are HEURISTICS, never confirmed symbols. */
const PROLOGUE_PATTERNS: Array<{ pattern: string; arch: FunctionCandidate['architecture']; bytes: number[] }> = [
    { pattern: 'x86-64 push rbp; mov rbp,rsp', arch: 'x86-64', bytes: [0x55, 0x48, 0x89, 0xe5] },
    { pattern: 'x86-64 mov rbp,rsp', arch: 'x86-64', bytes: [0x48, 0x89, 0xe5] },
    { pattern: 'x86-64 sub rsp,imm8', arch: 'x86-64', bytes: [0x48, 0x83, 0xec] },
    { pattern: 'x86 push ebp; mov ebp,esp', arch: 'x86', bytes: [0x55, 0x89, 0xe5] },
    { pattern: 'arm64 stp x29,x30,[sp,#-16]!', arch: 'arm64', bytes: [0xfd, 0x7b, 0xbf, 0xa9] },
    { pattern: 'arm64 mov x0,#1', arch: 'arm64', bytes: [0x20, 0x02, 0x00, 0xd0] }
];

// ------------------------------------------------------------------------------------------------
// REVERSE ENGINEERING
// ------------------------------------------------------------------------------------------------

export class ReverseEngineering {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('REVERSE_ENGINEERING_INIT', 'reverse-engineering', 'SUCCESS', { opId: ctx.operationId });
    }

    /** Read the real bytes of a file. Throws when the file cannot be read - never returns fake data. */
    private readReal(filePath: string): Buffer {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
            arsenalCore.audit('RE_FILE_READ', 'reverse-engineering', 'FAILED', { path: resolved, reason: 'not found' });
            throw new Error(`File not found: ${resolved}`);
        }
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
            arsenalCore.audit('RE_FILE_READ', 'reverse-engineering', 'FAILED', { path: resolved, reason: 'not a regular file' });
            throw new Error(`Not a regular file: ${resolved}`);
        }
        return fs.readFileSync(resolved);
    }

    private hash(buf: Buffer): { sha256: string; md5: string } {
        return {
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            md5: crypto.createHash('md5').update(buf).digest('hex')
        };
    }

    private decodeFlags(raw: number, table: Array<[number, string]>): string[] {
        const out: string[] = [];
        for (const [bit, name] of table) if (raw & bit) out.push(name);
        return out;
    }

    // ------------------------------------------------------------------------------------------------
    // A) identify()
    // ------------------------------------------------------------------------------------------------

    /**
     * Identify the real binary format and parse the real headers.
     * When the file is not a recognised container the format is 'UNKNOWN', the first 16 bytes are
     * returned, and parseError explains that no structure could be parsed.
     */
    identify(filePath: string): BinaryInfo {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);
        const hashes = this.hash(buf);
        const firstBytesHex = buf.subarray(0, 16).toString('hex');

        const info: BinaryInfo = {
            filePath: resolved,
            fileSize: buf.length,
            sha256: hashes.sha256,
            md5: hashes.md5,
            format: 'UNKNOWN',
            firstBytesHex,
            isDotNet: false
        };

        const isElf = buf.length >= 16 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
        const isPe = buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a;
        const machoMagic = buf.length >= 4 ? buf.readUInt32LE(0) : 0;
        const isWasm = buf.length >= 8 && buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d;

        try {
            if (isElf) {
                info.format = 'ELF';
                info.elf = this.parseElfHeader(buf);
                info.symbols = this.parseElfSymbols(buf, info.elf);
            } else if (isPe) {
                const pe = this.parsePeHeader(buf);
                info.pe = pe;
                info.format = pe.isDotNet ? 'DOTNET' : 'PE';
                info.isDotNet = pe.isDotNet;
            } else if (machoMagic === 0xfeedface || machoMagic === 0xfeedfacf ||
                       machoMagic === 0xcefaedfe || machoMagic === 0xcffaedfe) {
                info.format = 'MACHO';
                info.macho = this.parseMachoHeader(buf);
            } else if (machoMagic === 0xcafebabe) {
                // 0xCAFEBABE is shared by Java class files and Mach-O fat binaries.
                const javaMajor = buf.length >= 8 ? buf.readUInt16BE(6) : 0;
                if (javaMajor >= 45 && javaMajor < 200) {
                    info.format = 'JAVA_CLASS';
                    info.java = {
                        minorVersion: buf.readUInt16BE(4),
                        majorVersion: javaMajor
                    };
                } else {
                    info.format = 'MACHO';
                    info.macho = this.parseMachoHeader(buf);
                }
            } else if (isWasm) {
                info.format = 'WASM';
                info.wasm = { version: buf.readUInt32LE(4) };
            } else {
                info.parseError =
                    'Unrecognised container: no PE/ELF/Mach-O/Java/WASM magic matched the first bytes. ' +
                    'No structure could be parsed; no sections, imports or symbols are reported.';
            }
        } catch (e: any) {
            info.parseError = `Header parse aborted: ${e && e.message ? e.message : String(e)}`;
        }

        arsenalCore.audit('RE_IDENTIFY', 'reverse-engineering', info.parseError ? 'PARTIAL' : 'SUCCESS', {
            path: resolved,
            format: info.format,
            fileSize: buf.length,
            sha256: hashes.sha256
        });

        return info;
    }

    // ------------------------------------------------------------------------------------------------
    // PE header parsing (all fields read from the real buffer)
    // ------------------------------------------------------------------------------------------------

    private parsePeHeader(buf: Buffer): PeHeaderInfo {
        const eLfanew = buf.readUInt32LE(0x3c);
        if (eLfanew + 24 > buf.length) {
            throw new Error(`e_lfanew (${eLfanew}) points outside the file (${buf.length} bytes)`);
        }
        const peSignature = buf.subarray(eLfanew, eLfanew + 4).toString('latin1');
        if (peSignature !== 'PE\0\0') {
            throw new Error(`PE signature not found at e_lfanew=${eLfanew} (got ${JSON.stringify(peSignature)})`);
        }

        const coff = eLfanew + 4;
        const machine = buf.readUInt16LE(coff + 0);
        const numberOfSections = buf.readUInt16LE(coff + 2);
        const timestamp = buf.readUInt32LE(coff + 4);
        const sizeOfOptionalHeader = buf.readUInt16LE(coff + 16);
        const characteristics = buf.readUInt16LE(coff + 18);

        const opt = coff + 20;
        if (opt + 2 > buf.length) throw new Error('Optional header truncated');
        const optionalMagic = buf.readUInt16LE(opt);
        const isPe32Plus = optionalMagic === 0x20b;

        const addressOfEntryPoint = buf.readUInt32LE(opt + 16);
        const imageBase = isPe32Plus
            ? Number(buf.readBigUInt64LE(opt + 24))
            : buf.readUInt32LE(opt + 28);
        const sectionAlignment = buf.readUInt32LE(opt + 32);
        const fileAlignment = buf.readUInt32LE(opt + 36);
        const subsystem = buf.readUInt16LE(opt + 68);
        const dllCharacteristics = buf.readUInt16LE(opt + 70);
        const numberOfRvaAndSizes = buf.readUInt32LE(isPe32Plus ? opt + 108 : opt + 92);
        const dataDirStart = isPe32Plus ? opt + 112 : opt + 96;

        const dataDirectories: PeHeaderInfo['dataDirectories'] = [];
        for (let i = 0; i < Math.min(numberOfRvaAndSizes, 16); i++) {
            const off = dataDirStart + i * 8;
            if (off + 8 > buf.length) break;
            dataDirectories.push({
                index: i,
                name: PE_DATA_DIRECTORY_NAMES[i] || `Directory${i}`,
                virtualAddress: buf.readUInt32LE(off),
                size: buf.readUInt32LE(off + 4)
            });
        }

        const clr = dataDirectories.find(d => d.index === 14);
        const isDotNet = !!clr && clr.virtualAddress !== 0 && clr.size !== 0;

        return {
            dosSignature: buf.subarray(0, 2).toString('latin1'),
            eLfanew,
            peSignature: peSignature.replace(/\0/g, '\\0'),
            machine,
            machineName: PE_MACHINE[machine] || `UNKNOWN(0x${machine.toString(16)})`,
            numberOfSections,
            timestamp,
            timestampIso: new Date(timestamp * 1000).toISOString(),
            sizeOfOptionalHeader,
            characteristics,
            characteristicFlags: this.decodeFlags(characteristics, PE_CHARACTERISTICS),
            optionalMagic,
            optionalMagicName: optionalMagic === 0x10b ? 'PE32' : optionalMagic === 0x20b ? 'PE32+' : `UNKNOWN(0x${optionalMagic.toString(16)})`,
            addressOfEntryPoint,
            imageBase,
            sectionAlignment,
            fileAlignment,
            subsystem,
            subsystemName: PE_SUBSYSTEM[subsystem] || `UNKNOWN(${subsystem})`,
            dllCharacteristics,
            dllCharacteristicFlags: this.decodeFlags(dllCharacteristics, PE_DLL_CHARACTERISTICS),
            dataDirectories,
            isDotNet
        };
    }

    /** Resolve an RVA to a real file offset using the real section table. */
    private peRvaToOffset(buf: Buffer, rva: number): number | null {
        const pe = this.parsePeHeader(buf);
        const sectionTable = pe.eLfanew + 24 + pe.sizeOfOptionalHeader;
        for (let i = 0; i < pe.numberOfSections; i++) {
            const off = sectionTable + i * 40;
            if (off + 40 > buf.length) break;
            const virtualSize = buf.readUInt32LE(off + 8);
            const virtualAddress = buf.readUInt32LE(off + 12);
            const sizeOfRawData = buf.readUInt32LE(off + 16);
            const pointerToRawData = buf.readUInt32LE(off + 20);
            const span = Math.max(virtualSize, sizeOfRawData);
            if (rva >= virtualAddress && rva < virtualAddress + span) {
                const delta = rva - virtualAddress;
                if (pointerToRawData + delta >= buf.length) return null;
                return pointerToRawData + delta;
            }
        }
        // RVA inside the headers
        if (rva < sectionTable) return rva < buf.length ? rva : null;
        return null;
    }

    // ------------------------------------------------------------------------------------------------
    // ELF header / program header / section header parsing
    // ------------------------------------------------------------------------------------------------

    private parseElfHeader(buf: Buffer): ElfHeaderInfo {
        const eiClass = buf[4];
        const eiData = buf[5];
        if (eiClass !== 1 && eiClass !== 2) throw new Error(`Invalid EI_CLASS ${eiClass}`);
        if (eiData !== 1 && eiData !== 2) throw new Error(`Invalid EI_DATA ${eiData}`);
        const is64 = eiClass === 2;
        const little = eiData === 1;

        const u16 = (o: number) => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
        const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
        const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));

        const type = u16(16);
        const machine = u16(18);
        const entry = is64 ? u64(24) : u32(24);
        const phoff = is64 ? u64(32) : u32(28);
        const shoff = is64 ? u64(40) : u32(32);
        const phentsize = u16(is64 ? 54 : 42);
        const phnum = u16(is64 ? 56 : 44);
        const shentsize = u16(is64 ? 58 : 46);
        let shnum = u16(is64 ? 60 : 48);
        const shstrndx = u16(is64 ? 62 : 50);

        // Extended numbering: when e_shnum == 0 the real count lives in section header 0.
        if (shnum === 0 && shoff > 0 && shoff + shentsize <= buf.length) {
            shnum = is64 ? u64(shoff + 32) : u32(shoff + 20);
        }

        const programHeaders: ElfProgramHeader[] = [];
        for (let i = 0; i < phnum; i++) {
            const off = phoff + i * phentsize;
            if (off + (is64 ? 56 : 32) > buf.length) break;
            const pType = u32(off);
            const pFlags = is64 ? u32(off + 4) : u32(off + 24);
            const pOffset = is64 ? u64(off + 8) : u32(off + 4);
            const pVaddr = is64 ? u64(off + 16) : u32(off + 8);
            const pFilesz = is64 ? u64(off + 32) : u32(off + 16);
            const pMemsz = is64 ? u64(off + 40) : u32(off + 20);
            const pAlign = is64 ? u64(off + 48) : u32(off + 28);
            programHeaders.push({
                index: i,
                type: pType,
                typeName: ELF_PT_TYPES[pType] || `PT_UNKNOWN(0x${pType.toString(16)})`,
                flags: pFlags,
                offset: pOffset,
                vaddr: pVaddr,
                filesz: pFilesz,
                memsz: pMemsz,
                align: pAlign
            });
        }

        return {
            class: is64 ? 64 : 32,
            endianness: little ? 'little' : 'big',
            type,
            typeName: ELF_TYPES[type] || `ET_UNKNOWN(${type})`,
            machine,
            machineName: ELF_MACHINES[machine] || `EM_UNKNOWN(${machine})`,
            entry,
            phoff,
            shoff,
            phnum,
            shnum,
            shstrndx,
            programHeaders
        };
    }

    /** Read a raw ELF section header record (real bytes, no defaults). */
    private readElfSectionHeader(buf: Buffer, index: number): {
        name: string; type: number; flags: number; addr: number; offset: number;
        size: number; link: number; info: number; entsize: number; shstrndx: number;
    } | null {
        const elf = this.parseElfHeader(buf);
        const is64 = elf.class === 64;
        const little = elf.endianness === 'little';
        const u16 = (o: number) => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
        const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
        const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));

        const entsize = u16(is64 ? 58 : 46);
        const off = elf.shoff + index * entsize;
        if (off + entsize > buf.length) return null;

        const shName = u32(off + 0);
        const shType = u32(off + 4);
        const shFlags = is64 ? u64(off + 8) : u32(off + 8);
        const shAddr = is64 ? u64(off + 16) : u32(off + 12);
        const shOffset = is64 ? u64(off + 24) : u32(off + 16);
        const shSize = is64 ? u64(off + 32) : u32(off + 20);
        const shLink = u32(off + (is64 ? 40 : 24));
        const shInfo = u32(off + (is64 ? 44 : 28));
        const shEntsize = is64 ? u64(off + 56) : u32(off + 36);

        let name = '';
        if (elf.shstrndx > 0 || elf.shstrndx === 0) {
            const strtab = this.readElfSectionHeader(buf, elf.shstrndx);
            if (strtab && shName < strtab.size) {
                const nameOff = strtab.offset + shName;
                if (nameOff < buf.length) {
                    const end = buf.indexOf(0, nameOff);
                    name = buf.subarray(nameOff, end === -1 ? buf.length : end).toString('latin1');
                }
            }
        }

        return {
            name, type: shType, flags: shFlags, addr: shAddr, offset: shOffset,
            size: shSize, link: shLink, info: shInfo, entsize: shEntsize, shstrndx: elf.shstrndx
        };
    }

    /** Parse the real .dynsym table (real bytes) into SymbolInfo records. */
    private parseElfSymbols(buf: Buffer, elf: ElfHeaderInfo): SymbolInfo[] {
        const out: SymbolInfo[] = [];
        const is64 = elf.class === 64;
        const little = elf.endianness === 'little';
        const u16 = (o: number) => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
        const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
        const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));

        let dynsymIndex = -1;
        for (let i = 0; i < elf.shnum; i++) {
            const sh = this.readElfSectionHeader(buf, i);
            if (!sh) break;
            if (sh.type === 11) { dynsymIndex = i; break; }   // SHT_DYNSYM
        }
        if (dynsymIndex < 0) return out;

        const dynsym = this.readElfSectionHeader(buf, dynsymIndex)!;
        const strtab = this.readElfSectionHeader(buf, dynsym.link);
        const entrySize = dynsym.entsize || (is64 ? 24 : 16);
        if (entrySize <= 0) return out;

        const count = Math.floor(dynsym.size / entrySize);
        const STB: Record<number, string> = { 0: 'LOCAL', 1: 'GLOBAL', 2: 'WEAK', 10: 'GNU_UNIQUE' };
        const STT: Record<number, string> = {
            0: 'NOTYPE', 1: 'OBJECT', 2: 'FUNC', 3: 'SECTION', 4: 'FILE', 5: 'COMMON', 6: 'TLS', 10: 'GNU_IFUNC'
        };

        for (let i = 0; i < count; i++) {
            const off = dynsym.offset + i * entrySize;
            if (off + entrySize > buf.length) break;
            const stName = u32(off);
            const stInfo = is64 ? buf.readUInt8(off + 4) : buf.readUInt8(off + 12);
            const stValue = is64 ? u64(off + 8) : u32(off + 4);
            const stSize = is64 ? u64(off + 16) : u32(off + 8);

            let name = '';
            if (strtab && stName > 0 && stName < strtab.size) {
                const nOff = strtab.offset + stName;
                if (nOff < buf.length) {
                    const end = buf.indexOf(0, nOff);
                    name = buf.subarray(nOff, end === -1 ? buf.length : end).toString('latin1');
                }
            }
            out.push({
                name,
                value: stValue,
                size: stSize,
                bind: STB[stInfo >> 4] || `BIND(${stInfo >> 4})`,
                type: STT[stInfo & 0xf] || `TYPE(${stInfo & 0xf})`
            });
        }
        return out;
    }

    // ------------------------------------------------------------------------------------------------
    // Mach-O header parsing
    // ------------------------------------------------------------------------------------------------

    private parseMachoHeader(buf: Buffer): MachoHeaderInfo {
        const magicLE = buf.readUInt32LE(0);
        const is64 = magicLE === 0xfeedfacf || magicLE === 0xcffaedfe;
        const little = magicLE === 0xfeedface || magicLE === 0xfeedfacf;
        const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
        const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));
        const i32 = (o: number) => little ? buf.readInt32LE(o) : buf.readInt32BE(o);

        const cputype = i32(4);
        const cpusubtype = i32(8);
        const filetype = u32(12);
        const ncmds = u32(16);
        const sizeofcmds = u32(20);
        const flags = u32(24);

        const headerSize = is64 ? 32 : 28;
        const segments: MachoSegment[] = [];
        const dylibs: string[] = [];

        let cursor = headerSize;
        for (let i = 0; i < ncmds; i++) {
            if (cursor + 8 > buf.length) break;
            const cmd = u32(cursor);
            const cmdsize = u32(cursor + 4);
            if (cmdsize < 8) break;

            if (cmd === 0x19 || cmd === 0x1) {
                const segname = buf.subarray(cursor + 8, cursor + 24).toString('latin1').replace(/\0.*$/, '');
                if (cmd === 0x19) {
                    segments.push({
                        name: segname,
                        vmaddr: u64(cursor + 24),
                        vmsize: u64(cursor + 32),
                        fileoff: u64(cursor + 40),
                        filesize: u64(cursor + 48),
                        nsects: u32(cursor + 64),
                        maxprot: i32(cursor + 56),
                        initprot: i32(cursor + 60)
                    });
                } else {
                    segments.push({
                        name: segname,
                        vmaddr: u32(cursor + 24),
                        vmsize: u32(cursor + 28),
                        fileoff: u32(cursor + 32),
                        filesize: u32(cursor + 36),
                        nsects: u32(cursor + 48),
                        maxprot: i32(cursor + 40),
                        initprot: i32(cursor + 44)
                    });
                }
            } else if (cmd === 0xc || cmd === 0xd || cmd === 0x20 || cmd === 0x80000018) {
                // dylib_command: name is a str_offset relative to the start of the command.
                const nameOffset = u32(cursor + 8);
                const abs = cursor + nameOffset;
                if (abs < buf.length) {
                    const end = buf.indexOf(0, abs);
                    dylibs.push(buf.subarray(abs, end === -1 ? buf.length : end).toString('latin1'));
                }
            }

            cursor += cmdsize;
        }

        return {
            magic: `0x${magicLE.toString(16).padStart(8, '0')}`,
            cputype,
            cpusubtype,
            filetype,
            ncmds,
            sizeofcmds,
            flags,
            segments,
            dylibs
        };
    }

    // ------------------------------------------------------------------------------------------------
    // B) parseSections()
    // ------------------------------------------------------------------------------------------------

    /**
     * Parse the REAL section table and compute Shannon entropy over the REAL section bytes.
     * PE section headers, ELF section headers, and Mach-O segments are supported.
     */
    parseSections(filePath: string): SectionInfo[] {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);
        const sections = this.parseSectionsFromBuffer(buf);

        arsenalCore.audit('RE_PARSE_SECTIONS', 'reverse-engineering', 'SUCCESS', {
            path: resolved,
            sections: sections.length
        });
        return sections;
    }

    private parseSectionsFromBuffer(buf: Buffer): SectionInfo[] {
        const out: SectionInfo[] = [];

        const isElf = buf.length >= 16 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
        const isPe = buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a;
        const machoMagic = buf.length >= 4 ? buf.readUInt32LE(0) : 0;

        if (isPe) {
            const pe = this.parsePeHeader(buf);
            const sectionTable = pe.eLfanew + 24 + pe.sizeOfOptionalHeader;
            for (let i = 0; i < pe.numberOfSections; i++) {
                const off = sectionTable + i * 40;
                if (off + 40 > buf.length) break;
                const rawName = buf.subarray(off, off + 8).toString('latin1');
                const name = rawName.replace(/\0.*$/, '');
                const virtualSize = buf.readUInt32LE(off + 8);
                const virtualAddress = buf.readUInt32LE(off + 12);
                const rawSize = buf.readUInt32LE(off + 16);
                const rawOffset = buf.readUInt32LE(off + 20);
                const characteristics = buf.readUInt32LE(off + 36);

                const body = rawOffset < buf.length
                    ? buf.subarray(rawOffset, Math.min(rawOffset + rawSize, buf.length))
                    : Buffer.alloc(0);
                const entropy = shannonEntropy(body);
                const flags = this.decodeFlags(characteristics, PE_SECTION_CHARACTERISTICS);
                const writable = (characteristics & 0x80000000) !== 0;
                const executable = (characteristics & 0x20000000) !== 0;

                const anomalies: string[] = [];
                if (entropy >= 7.2) anomalies.push('HIGH_ENTROPY');
                if (rawSize === 0) anomalies.push('ZERO_RAW_SIZE');
                if (writable && executable) anomalies.push('WRITABLE_AND_EXECUTABLE');
                if (PACKER_SECTION_NAMES.includes(name)) anomalies.push('PACKER_SECTION_NAME');

                out.push({
                    name, virtualAddress, virtualSize, rawOffset, rawSize, entropy,
                    characteristics, flags, writable, executable,
                    anomalies
                });
            }
            return out;
        }

        if (isElf) {
            const elf = this.parseElfHeader(buf);
            const is64 = elf.class === 64;
            const little = elf.endianness === 'little';
            const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
            const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));

            for (let i = 0; i < elf.shnum; i++) {
                const sh = this.readElfSectionHeader(buf, i);
                if (!sh) break;
                const rawSize = sh.size;
                const rawOffset = sh.offset;
                // SHT_NOBITS occupies no file space - it must not be scored on file bytes.
                const body = (sh.type === 8 || rawOffset >= buf.length)
                    ? Buffer.alloc(0)
                    : buf.subarray(rawOffset, Math.min(rawOffset + rawSize, buf.length));
                const entropy = sh.type === 8 ? 0 : shannonEntropy(body);
                const flags = this.decodeFlags(sh.flags, ELF_SHF);
                const writable = (sh.flags & 0x1) !== 0;
                const executable = (sh.flags & 0x4) !== 0;

                const anomalies: string[] = [];
                if (entropy >= 7.2) anomalies.push('HIGH_ENTROPY');
                if (sh.type !== 8 && rawSize === 0) anomalies.push('ZERO_RAW_SIZE');
                if (writable && executable) anomalies.push('WRITABLE_AND_EXECUTABLE');
                if (PACKER_SECTION_NAMES.includes(sh.name)) anomalies.push('PACKER_SECTION_NAME');

                out.push({
                    name: sh.name,
                    virtualAddress: sh.addr,
                    virtualSize: rawSize,
                    rawOffset,
                    rawSize,
                    entropy,
                    characteristics: sh.flags,
                    flags,
                    writable,
                    executable,
                    type: ELF_SHT_TYPES[sh.type] || `SHT_${sh.type}`,
                    entsize: sh.entsize,
                    anomalies
                });
            }
            void u32; void u64;
            return out;
        }

        if (machoMagic === 0xfeedface || machoMagic === 0xfeedfacf ||
            machoMagic === 0xcefaedfe || machoMagic === 0xcffaedfe) {
            const macho = this.parseMachoHeader(buf);
            for (const seg of macho.segments) {
                const body = seg.fileoff < buf.length
                    ? buf.subarray(seg.fileoff, Math.min(seg.fileoff + seg.filesize, buf.length))
                    : Buffer.alloc(0);
                const entropy = shannonEntropy(body);
                const executable = (seg.initprot & 1) !== 0;
                const writable = (seg.initprot & 2) !== 0;
                const anomalies: string[] = [];
                if (entropy >= 7.2) anomalies.push('HIGH_ENTROPY');
                if (writable && executable) anomalies.push('WRITABLE_AND_EXECUTABLE');
                if (PACKER_SECTION_NAMES.includes(seg.name)) anomalies.push('PACKER_SECTION_NAME');
                out.push({
                    name: seg.name,
                    virtualAddress: seg.vmaddr,
                    virtualSize: seg.vmsize,
                    rawOffset: seg.fileoff,
                    rawSize: seg.filesize,
                    entropy,
                    characteristics: seg.initprot,
                    flags: [
                        ...(seg.initprot & 1 ? ['READ'] : []),
                        ...(seg.initprot & 2 ? ['WRITE'] : []),
                        ...(seg.initprot & 4 ? ['EXECUTE'] : [])
                    ],
                    writable,
                    executable,
                    anomalies
                });
            }
            return out;
        }

        return out;
    }

    // ------------------------------------------------------------------------------------------------
    // C) extractStrings()
    // ------------------------------------------------------------------------------------------------

    /**
     * Extract REAL printable strings from the REAL bytes.
     * Both ASCII (0x20-0x7E) runs and UTF-16LE runs are reported with their true byte offsets.
     */
    extractStrings(filePath: string, minLength = 6): StringExtraction {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);
        const result = this.extractStringsFromBuffer(buf, minLength);

        arsenalCore.audit('RE_EXTRACT_STRINGS', 'reverse-engineering', 'SUCCESS', {
            path: resolved,
            strings: result.count,
            minLength
        });
        return result;
    }

    private extractStringsFromBuffer(buf: Buffer, minLength: number): StringExtraction {
        const hits: StringHit[] = [];
        const MAX_HITS = 5000;

        // ASCII runs: bytes 0x20..0x7E
        let runStart = -1;
        for (let i = 0; i <= buf.length; i++) {
            const b = i < buf.length ? buf[i] : 0;
            const printable = i < buf.length && b >= 0x20 && b <= 0x7e;
            if (printable) {
                if (runStart === -1) runStart = i;
            } else if (runStart !== -1) {
                const len = i - runStart;
                if (len >= minLength && hits.length < MAX_HITS) {
                    hits.push({
                        offset: runStart,
                        length: len,
                        text: buf.subarray(runStart, i).toString('latin1'),
                        encoding: 'ASCII'
                    });
                }
                runStart = -1;
            }
        }

        // UTF-16LE runs: printable byte followed by 0x00
        let wRunStart = -1;
        for (let i = 0; i <= buf.length; i += 2) {
            const printable = i + 1 < buf.length && buf[i] >= 0x20 && buf[i] <= 0x7e && buf[i + 1] === 0x00;
            if (printable) {
                if (wRunStart === -1) wRunStart = i;
            } else if (wRunStart !== -1) {
                const chars = (i - wRunStart) / 2;
                if (chars >= minLength && hits.length < MAX_HITS) {
                    hits.push({
                        offset: wRunStart,
                        length: i - wRunStart,
                        text: buf.subarray(wRunStart, i).toString('utf16le'),
                        encoding: 'UTF16LE'
                    });
                }
                wRunStart = -1;
            }
        }

        hits.sort((a, b) => a.offset - b.offset || (a.encoding === 'ASCII' ? -1 : 1));
        return {
            strings: hits,
            count: hits.length,
            minLength,
            truncated: hits.length >= MAX_HITS
        };
    }

    // ------------------------------------------------------------------------------------------------
    // D) parseImports()
    // ------------------------------------------------------------------------------------------------

    /**
     * Parse the REAL import table.
     * PE : walks the real IMAGE_IMPORT_DESCRIPTOR array and resolves the Import Name Table.
     * ELF: reads the real DT_NEEDED entries and the real PLT/GOT relocation symbol indexes.
     * If a format exposes no import information the array is EMPTY and the reason is explicit.
     */
    parseImports(filePath: string): ImportEntry[] {
        return this.resolveImports(filePath).imports;
    }

    resolveImports(filePath: string): ImportResolution {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);

        const isElf = buf.length >= 16 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
        const isPe = buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a;

        let result: ImportResolution;
        if (isPe) {
            result = this.parsePeImports(buf);
        } else if (isElf) {
            result = this.parseElfImports(buf);
        } else {
            result = {
                imports: [],
                resolved: false,
                format: 'UNKNOWN',
                reason: 'File format exposes no import table (not PE, not ELF). No DLL names are reported.'
            };
        }

        arsenalCore.audit('RE_PARSE_IMPORTS', 'reverse-engineering', result.resolved ? 'SUCCESS' : 'PARTIAL', {
            path: resolved,
            libraries: result.imports.length,
            symbols: result.imports.reduce((n, e) => n + e.symbols.length, 0),
            reason: result.reason
        });
        return result;
    }

    private readCString(buf: Buffer, offset: number, limit = 512): string {
        if (offset < 0 || offset >= buf.length) return '';
        const end = Math.min(buf.length, offset + limit);
        const nul = buf.indexOf(0, offset);
        const stop = (nul === -1 || nul > end) ? end : nul;
        return buf.subarray(offset, stop).toString('latin1');
    }

    private parsePeImports(buf: Buffer): ImportResolution {
        const pe = this.parsePeHeader(buf);
        const importDir = pe.dataDirectories.find(d => d.index === 1);
        if (!importDir || importDir.virtualAddress === 0) {
            return {
                imports: [],
                resolved: false,
                format: 'PE',
                reason: 'PE Import data directory (index 1) is empty - this image imports nothing.'
            };
        }

        const isPe32Plus = pe.optionalMagic === 0x20b;
        const thunkSize = isPe32Plus ? 8 : 4;
        const ordinalFlag = isPe32Plus ? 0x8000000000000000n : 0x80000000n;

        const imports: ImportEntry[] = [];
        const descOffset = this.peRvaToOffset(buf, importDir.virtualAddress);
        if (descOffset === null) {
            return {
                imports: [],
                resolved: false,
                format: 'PE',
                reason: `Import directory RVA 0x${importDir.virtualAddress.toString(16)} does not map into any section.`
            };
        }

        for (let i = 0; i < 512; i++) {
            const off = descOffset + i * 20;
            if (off + 20 > buf.length) break;
            const originalFirstThunk = buf.readUInt32LE(off);
            const nameRva = buf.readUInt32LE(off + 12);
            const firstThunk = buf.readUInt32LE(off + 16);
            if (nameRva === 0 && firstThunk === 0 && originalFirstThunk === 0) break;   // null terminator

            const nameOff = this.peRvaToOffset(buf, nameRva);
            const library = nameOff !== null ? this.readCString(buf, nameOff) : '';
            const thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk;
            const thunkOff = this.peRvaToOffset(buf, thunkRva);

            const symbols: string[] = [];
            let firstOrdinal: number | undefined;
            if (thunkOff !== null) {
                for (let j = 0; j < 4096; j++) {
                    const tOff = thunkOff + j * thunkSize;
                    if (tOff + thunkSize > buf.length) break;
                    let value: bigint;
                    if (isPe32Plus) {
                        value = buf.readBigUInt64LE(tOff);
                    } else {
                        value = BigInt(buf.readUInt32LE(tOff));
                    }
                    if (value === 0n) break;
                    if (value & ordinalFlag) {
                        const ordinal = Number(value & 0xffffn);
                        if (firstOrdinal === undefined) firstOrdinal = ordinal;
                        symbols.push(`#${ordinal}`);
                    } else {
                        const hintRva = Number(value);
                        const hintOff = this.peRvaToOffset(buf, hintRva);
                        if (hintOff !== null) {
                            // IMAGE_IMPORT_BY_NAME: 2-byte hint followed by the null-terminated name.
                            const fname = this.readCString(buf, hintOff + 2);
                            if (fname) symbols.push(fname);
                        }
                    }
                }
            }

            imports.push({
                library,
                symbols,
                source: 'PE_IMPORT_DESCRIPTOR',
                ...(firstOrdinal !== undefined ? { ordinal: firstOrdinal } : {})
            });
        }

        return {
            imports,
            resolved: imports.length > 0,
            format: 'PE',
            reason: imports.length > 0
                ? `Resolved ${imports.length} import descriptor(s) from the real PE import directory.`
                : 'PE import directory present but no descriptors could be decoded.'
        };
    }

    private parseElfImports(buf: Buffer): ImportResolution {
        const elf = this.parseElfHeader(buf);
        const is64 = elf.class === 64;
        const little = elf.endianness === 'little';
        const u32 = (o: number) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
        const u64 = (o: number) => little ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o));

        // Locate .dynstr, .dynsym, .dynamic and the relocation sections by their real headers.
        let dynstr: { offset: number; size: number } | null = null;
        let dynsymIdx = -1;
        let dynamic: { offset: number; size: number } | null = null;
        const relas: Array<{ name: string; offset: number; size: number; entsize: number; type: number }> = [];

        for (let i = 0; i < elf.shnum; i++) {
            const sh = this.readElfSectionHeader(buf, i);
            if (!sh) break;
            if (sh.type === 3 && sh.name === '.dynstr') dynstr = { offset: sh.offset, size: sh.size };
            if (sh.type === 11) dynsymIdx = i;
            if (sh.type === 6) dynamic = { offset: sh.offset, size: sh.size };
            if (sh.type === 4 || sh.type === 9) {
                relas.push({ name: sh.name, offset: sh.offset, size: sh.size, entsize: sh.entsize, type: sh.type });
            }
        }

        if (!dynstr) {
            return {
                imports: [],
                resolved: false,
                format: 'ELF',
                reason: 'No .dynstr section found - the image is statically linked or has no dynamic string table.'
            };
        }

        const readStr = (idx: number): string => {
            if (idx >= dynstr!.size) return '';
            const off = dynstr!.offset + idx;
            return this.readCString(buf, off);
        };

        // DT_NEEDED from the real .dynamic section
        const libraries: Array<{ name: string; symbols: string[] }> = [];
        if (dynamic) {
            const entrySize = is64 ? 16 : 8;
            for (let off = dynamic.offset; off + entrySize <= Math.min(dynamic.offset + dynamic.size, buf.length); off += entrySize) {
                const tag = is64 ? Number(buf.readBigInt64LE(off)) : u32(off);
                const val = is64 ? u64(off + 8) : u32(off + 4);
                if (tag === 0) break;                       // DT_NULL
                if (tag === 1) {                            // DT_NEEDED
                    libraries.push({ name: readStr(val), symbols: [] });
                }
            }
        }

        // PLT/GOT relocations give the real imported symbol names via .dynsym indexes.
        const symbolNamesByIndex = new Map<number, string>();
        if (dynsymIdx >= 0) {
            const dynsym = this.readElfSectionHeader(buf, dynsymIdx)!;
            const entrySize = dynsym.entsize || (is64 ? 24 : 16);
            const count = Math.floor(dynsym.size / entrySize);
            for (let i = 0; i < count; i++) {
                const off = dynsym.offset + i * entrySize;
                if (off + entrySize > buf.length) break;
                const stName = u32(off);
                const name = stName > 0 ? readStr(stName) : '';
                if (name) symbolNamesByIndex.set(i, name);
            }
        }

        const pltSymbols: string[] = [];
        const dynSymbols: string[] = [];
        for (const rel of relas) {
            // PLT relocations reference the functions the binary imports; .rela.dyn covers data relocations.
            const isPlt = /\.rela?\.plt/i.test(rel.name) || /\.iplt/i.test(rel.name);
            const entrySize = rel.entsize || (rel.type === 4 ? (is64 ? 24 : 12) : (is64 ? 16 : 8));
            for (let off = rel.offset; off + entrySize <= buf.length && off + entrySize <= rel.offset + rel.size; off += entrySize) {
                const rInfo = is64 ? buf.readBigUInt64LE(off + 8) : BigInt(u32(off + 4));
                const symIndex = is64 ? Number(rInfo >> 32n) : Number(rInfo >> 8n);
                const name = symbolNamesByIndex.get(symIndex);
                if (!name) continue;
                if (isPlt) {
                    if (!pltSymbols.includes(name)) pltSymbols.push(name);
                } else if (rel.name === '.rela.dyn' || rel.name === '.rel.dyn') {
                    // Dynamic relocations also reference imported data objects; keep them separate.
                    if (!dynSymbols.includes(name)) dynSymbols.push(name);
                }
            }
        }

        if (libraries.length === 0 && pltSymbols.length === 0 && dynSymbols.length === 0) {
            return {
                imports: [],
                resolved: false,
                format: 'ELF',
                reason: 'No DT_NEEDED entries and no resolvable PLT/GOT relocation symbols were found in the real dynamic tables.'
            };
        }

        // Attach the unresolved symbol list to the first library, and emit the symbols honestly.
        const imports: ImportEntry[] = libraries.map(l => ({
            library: l.name,
            symbols: [],
            source: 'ELF_DT_NEEDED' as const
        }));

        if (pltSymbols.length > 0) {
            if (imports.length === 0) {
                imports.push({ library: '(unspecified shared object)', symbols: [], source: 'ELF_PLT_RELOC' });
            }
            imports[imports.length - 1].symbols = pltSymbols;
            imports[imports.length - 1].source = 'ELF_PLT_RELOC';
        }

        if (dynSymbols.length > 0) {
            imports.push({
                library: '(dynamic relocations / .rela.dyn)',
                symbols: dynSymbols,
                source: 'ELF_UNDEFINED_SYMBOL'
            });
        }

        return {
            imports,
            resolved: imports.length > 0,
            format: 'ELF',
            reason: `Resolved ${libraries.length} DT_NEEDED entr(ies), ${pltSymbols.length} PLT symbol(s) and ${dynSymbols.length} dynamic relocation symbol(s) from the real ELF tables.`
        };
    }

    // ------------------------------------------------------------------------------------------------
    // E) findFunctions()
    // ------------------------------------------------------------------------------------------------

    /**
     * Scan the REAL executable sections for REAL function prologue byte patterns.
     * Every result is explicitly a HEURISTIC candidate - never a confirmed function address.
     */
    findFunctions(filePath: string): FunctionCandidate[] {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);
        const candidates = this.findFunctionsInBuffer(buf);

        arsenalCore.audit('RE_FIND_FUNCTIONS', 'reverse-engineering', 'SUCCESS', {
            path: resolved,
            candidates: candidates.length,
            note: 'heuristic prologue matches'
        });
        return candidates;
    }

    private findFunctionsInBuffer(buf: Buffer): FunctionCandidate[] {
        const sections = this.parseSectionsFromBuffer(buf);
        const out: FunctionCandidate[] = [];
        const seen = new Set<string>();

        for (const sec of sections) {
            if (!sec.executable) continue;
            if (sec.rawOffset >= buf.length) continue;
            const body = buf.subarray(sec.rawOffset, Math.min(sec.rawOffset + sec.rawSize, buf.length));
            if (body.length === 0) continue;

            for (const pat of PROLOGUE_PATTERNS) {
                const needle = Buffer.from(pat.bytes);
                let idx = body.indexOf(needle);
                while (idx !== -1) {
                    const fileOffset = sec.rawOffset + idx;
                    const key = `${fileOffset}:${pat.pattern}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        const follow = body.subarray(idx, Math.min(idx + 16, body.length));
                        out.push({
                            offset: fileOffset,
                            pattern: pat.pattern,
                            architecture: pat.arch,
                            bytesHex: follow.toString('hex'),
                            confidence: 'LOW',
                            heuristic: true
                        });
                    }
                    idx = body.indexOf(needle, idx + 1);
                }
            }
        }

        out.sort((a, b) => a.offset - b.offset);
        return out;
    }

    // ------------------------------------------------------------------------------------------------
    // F) detectSuspiciousIndicators()
    // ------------------------------------------------------------------------------------------------

    /**
     * Real byte-level indicator detection.
     * Every indicator below is derived from bytes that are actually present in the file.
     */
    detectSuspiciousIndicators(filePath: string): { indicators: SuspiciousIndicator[]; score: number } {
        const resolved = path.resolve(filePath);
        const buf = this.readReal(resolved);
        const indicators = this.detectIndicatorsInBuffer(buf);
        const score = this.scoreIndicators(indicators);

        arsenalCore.audit('RE_DETECT_INDICATORS', 'reverse-engineering', 'SUCCESS', {
            path: resolved,
            indicators: indicators.length,
            score
        });
        return { indicators, score };
    }

    private detectIndicatorsInBuffer(buf: Buffer): SuspiciousIndicator[] {
        const indicators: SuspiciousIndicator[] = [];
        const sections = this.parseSectionsFromBuffer(buf);
        const strings = this.extractStringsFromBuffer(buf, 6);

        // 1. High-entropy sections (real Shannon entropy over real section bytes)
        for (const sec of sections) {
            if (sec.entropy >= 7.2 && sec.rawSize > 0) {
                indicators.push({
                    type: 'HIGH_ENTROPY_SECTION',
                    severity: 'MEDIUM',
                    detail: `Section "${sec.name}" has Shannon entropy ${sec.entropy} (>= 7.2) over ${sec.rawSize} real bytes - possible packing or encryption`,
                    offset: sec.rawOffset
                });
            }
        }

        // 2. Known packer section names (matched against the real section table)
        for (const sec of sections) {
            if (PACKER_SECTION_NAMES.includes(sec.name)) {
                indicators.push({
                    type: 'PACKER_SECTION_NAME',
                    severity: 'HIGH',
                    detail: `Section name "${sec.name}" matches a known packer section naming convention`,
                    offset: sec.rawOffset
                });
            }
        }

        // 3. Writable + executable sections (real permission flags)
        for (const sec of sections) {
            if (sec.writable && sec.executable) {
                indicators.push({
                    type: 'WRITABLE_EXECUTABLE_SECTION',
                    severity: 'HIGH',
                    detail: `Section "${sec.name}" is both writable and executable (raw flags 0x${sec.characteristics.toString(16)})`,
                    offset: sec.rawOffset
                });
            }
        }

        // 4. PDB debug path embedded in the real strings
        for (const s of strings.strings) {
            if (/\.[pP][dD][bB]$/.test(s.text.trim()) || /[A-Za-z]:\\[^\s"']*\.pdb/i.test(s.text)) {
                indicators.push({
                    type: 'PDB_DEBUG_PATH',
                    severity: 'LOW',
                    detail: `PDB debug path string found in the binary: "${s.text.slice(0, 200)}"`,
                    offset: s.offset
                });
                break;
            }
        }

        // 5. URLs inside the real strings
        const urlRe = /\bhttps?:\/\/[^\s"'<>\\]{4,}/gi;
        const seenUrls = new Set<string>();
        for (const s of strings.strings) {
            let m: RegExpExecArray | null;
            urlRe.lastIndex = 0;
            while ((m = urlRe.exec(s.text)) !== null) {
                const url = m[0];
                if (seenUrls.has(url)) continue;
                seenUrls.add(url);
                indicators.push({
                    type: 'EMBEDDED_URL',
                    severity: 'MEDIUM',
                    detail: `URL literal present in binary strings: ${url.slice(0, 200)}`,
                    offset: s.offset
                });
                if (seenUrls.size >= 10) break;
            }
            if (seenUrls.size >= 10) break;
        }

        // 6. IPv4 literals inside the real strings
        const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
        const seenIps = new Set<string>();
        for (const s of strings.strings) {
            let m: RegExpExecArray | null;
            ipRe.lastIndex = 0;
            while ((m = ipRe.exec(s.text)) !== null) {
                const parts = m[0].split('.').map(Number);
                if (!parts.every(p => p >= 0 && p <= 255)) continue;
                if (seenIps.has(m[0])) continue;
                seenIps.add(m[0]);
                indicators.push({
                    type: 'EMBEDDED_IPV4',
                    severity: 'LOW',
                    detail: `IPv4 literal present in binary strings: ${m[0]}`,
                    offset: s.offset
                });
                if (seenIps.size >= 10) break;
            }
            if (seenIps.size >= 10) break;
        }

        // 7. Cryptographic constants found verbatim in the real bytes
        for (const c of CRYPTO_CONSTANTS) {
            const needle = Buffer.from(c.bytes);
            const idx = buf.indexOf(needle);
            if (idx !== -1) {
                indicators.push({
                    type: `CRYPTO_CONSTANT_${c.name}`,
                    severity: 'MEDIUM',
                    detail: `${c.detail} found verbatim at file offset 0x${idx.toString(16)}`,
                    offset: idx
                });
            }
        }

        // 8. Embedded PE (a second MZ magic at an offset > 0)
        let mzOffset = buf.indexOf(Buffer.from([0x4d, 0x5a]), 1);
        while (mzOffset !== -1) {
            let verified = 'no PE header found at its e_lfanew';
            if (mzOffset + 0x40 <= buf.length) {
                const inner = buf.readUInt32LE(mzOffset + 0x3c);
                if (inner > 0 && mzOffset + inner + 4 <= buf.length &&
                    buf.readUInt32LE(mzOffset + inner) === 0x00004550) {
                    verified = 'a valid PE signature was confirmed at its e_lfanew';
                }
            }
            indicators.push({
                type: 'EMBEDDED_PE',
                severity: 'HIGH',
                detail: `Second MZ magic found at file offset 0x${mzOffset.toString(16)} (${verified})`,
                offset: mzOffset
            });
            mzOffset = buf.indexOf(Buffer.from([0x4d, 0x5a]), mzOffset + 1);
        }

        return indicators;
    }

    private scoreIndicators(indicators: SuspiciousIndicator[]): number {
        const weights: Record<string, number> = {
            EMBEDDED_PE: 25,
            PACKER_SECTION_NAME: 20,
            WRITABLE_EXECUTABLE_SECTION: 15,
            HIGH_ENTROPY_SECTION: 10,
            CRYPTO_CONSTANT_AES_SBOX: 12,
            CRYPTO_CONSTANT_TEA_DELTA: 10,
            CRYPTO_CONSTANT_TEA_DELTA_BE: 10,
            CRYPTO_CONSTANT_RC4_SBOX_START: 10,
            CRYPTO_CONSTANT_SHA256_K0: 6,
            CRYPTO_CONSTANT_MD5_T1: 6,
            EMBEDDED_URL: 8,
            EMBEDDED_IPV4: 5,
            PDB_DEBUG_PATH: 3
        };
        let score = 0;
        for (const ind of indicators) score += weights[ind.type] ?? 4;
        return Math.min(100, score);
    }

    // ------------------------------------------------------------------------------------------------
    // G) analyze()
    // ------------------------------------------------------------------------------------------------

    /**
     * Full static analysis report of a real file.
     * Findings are recorded through arsenalCore.addFinding with MITRE-mapped categories.
     */
    analyze(filePath: string): ReverseAnalysisReport {
        const resolved = path.resolve(filePath);
        arsenalCore.audit('RE_ANALYZE', 'reverse-engineering', 'ATTEMPT', { path: resolved });

        const info = this.identify(resolved);
        const sections = this.parseSections(resolved);
        const strings = this.extractStrings(resolved, 6);
        const imports = this.resolveImports(resolved);
        const functions = this.findFunctions(resolved);
        const { indicators, score } = this.detectSuspiciousIndicators(resolved);

        const findings: Finding[] = [];

        // malware_indicator finding when real indicators were observed.
        const strongIndicators = indicators.filter(i => i.severity === 'HIGH' || i.severity === 'MEDIUM');
        if (strongIndicators.length > 0) {
            findings.push(arsenalCore.addFinding({
                title: `Static analysis indicators observed in ${path.basename(resolved)}`,
                severity: score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW',
                category: 'malware_indicator',
                description: strongIndicators.map(i => `${i.type}: ${i.detail}`).join('; ').slice(0, 1800),
                evidence: {
                    path: resolved,
                    sha256: info.sha256,
                    format: info.format,
                    score,
                    indicators
                },
                remediation: 'Quarantine the sample and analyse it in an isolated sandbox before execution',
                verified: true
            }));
        }

        // weak_crypto finding when real crypto constants were found verbatim.
        const cryptoIndicators = indicators.filter(i => i.type.startsWith('CRYPTO_CONSTANT_'));
        if (cryptoIndicators.length > 0) {
            findings.push(arsenalCore.addFinding({
                title: `Cryptographic constants embedded in ${path.basename(resolved)}`,
                severity: 'MEDIUM',
                category: 'weak_crypto',
                description: cryptoIndicators.map(i => `${i.type}: ${i.detail}`).join('; ').slice(0, 1200),
                evidence: {
                    path: resolved,
                    sha256: info.sha256,
                    constants: cryptoIndicators
                },
                remediation: 'Replace custom cryptographic implementations with audited, modern primitives',
                verified: true
            }));
        }

        const report: ReverseAnalysisReport = {
            filePath: resolved,
            fileSize: info.fileSize,
            sha256: info.sha256,
            md5: info.md5,
            format: info.format,
            identify: info,
            sections,
            strings,
            imports,
            functions,
            indicators,
            score,
            findings,
            analyzedAt: Date.now()
        };

        arsenalCore.audit('RE_ANALYZE', 'reverse-engineering', 'SUCCESS', {
            path: resolved,
            format: info.format,
            sections: sections.length,
            strings: strings.count,
            libraries: imports.imports.length,
            functions: functions.length,
            indicators: indicators.length,
            score,
            findings: findings.length
        });

        return report;
    }
}

export default ReverseEngineering;
