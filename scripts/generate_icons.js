import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Function to generate high-resolution, visually stunning SVG icons
function generateSvgIcon(size, isMaskable = false) {
  const safePadding = isMaskable ? size * 0.15 : size * 0.06;
  const contentSize = size - safePadding * 2;
  const center = size / 2;
  const radius = isMaskable ? 0 : size * 0.18;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <!-- Background Gradient -->
    <radialGradient id="bgGrad" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#0c162d"/>
      <stop offset="60%" stop-color="#070a14"/>
      <stop offset="100%" stop-color="#04060b"/>
    </radialGradient>

    <!-- Metallic Shield Gradient -->
    <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="30%" stop-color="#0891b2"/>
      <stop offset="70%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#030712"/>
    </linearGradient>

    <!-- Holographic Neon Border Gradient -->
    <linearGradient id="neonBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>

    <!-- Core Reactor Glow -->
    <radialGradient id="reactorCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#38bdf8"/>
      <stop offset="75%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#082f49"/>
    </radialGradient>

    <!-- Glow Filter -->
    <filter id="cyberGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${size * 0.02}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="intenseGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${size * 0.035}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Base Plate (Square for maskable, rounded squircle for standard) -->
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bgGrad)" stroke="#1e293b" stroke-width="${size * 0.008}"/>

  <!-- Subtle Cybernetic Tech Grid -->
  <g opacity="0.12" stroke="#38bdf8" stroke-width="${size * 0.002}">
    <line x1="0" y1="${size * 0.25}" x2="${size}" y2="${size * 0.25}"/>
    <line x1="0" y1="${size * 0.5}" x2="${size}" y2="${size * 0.5}"/>
    <line x1="0" y1="${size * 0.75}" x2="${size}" y2="${size * 0.75}"/>
    <line x1="${size * 0.25}" y1="0" x2="${size * 0.25}" y2="${size}"/>
    <line x1="${size * 0.5}" y1="0" x2="${size * 0.5}" y2="${size}"/>
    <line x1="${size * 0.75}" y1="0" x2="${size * 0.75}" y2="${size}"/>
  </g>

  <!-- Orbital Sensor Ring -->
  <circle cx="${center}" cy="${center}" r="${contentSize * 0.44}" fill="none" stroke="#1e3a5f" stroke-width="${size * 0.01}" stroke-dasharray="${size * 0.05} ${size * 0.02}"/>
  <circle cx="${center}" cy="${center}" r="${contentSize * 0.38}" fill="none" stroke="#0284c7" stroke-width="${size * 0.006}" opacity="0.4"/>

  <!-- Sovereign Shield Crest -->
  <g filter="url(#cyberGlow)">
    <!-- Outer Shield Frame -->
    <path d="M${center} ${center - contentSize * 0.38} 
             L${center + contentSize * 0.32} ${center - contentSize * 0.2} 
             L${center + contentSize * 0.32} ${center + contentSize * 0.08} 
             C${center + contentSize * 0.32} ${center + contentSize * 0.32} ${center} ${center + contentSize * 0.44} ${center} ${center + contentSize * 0.44} 
             C${center} ${center + contentSize * 0.44} ${center - contentSize * 0.32} ${center + contentSize * 0.32} ${center - contentSize * 0.32} ${center + contentSize * 0.08} 
             L${center - contentSize * 0.32} ${center - contentSize * 0.2} Z" 
          fill="url(#shieldGrad)" 
          stroke="url(#neonBorder)" 
          stroke-width="${size * 0.016}" 
          stroke-linejoin="round"/>

    <!-- Inner Circuit Inset -->
    <path d="M${center} ${center - contentSize * 0.3} 
             L${center + contentSize * 0.24} ${center - contentSize * 0.15} 
             L${center + contentSize * 0.24} ${center + contentSize * 0.06} 
             C${center + contentSize * 0.24} ${center + contentSize * 0.24} ${center} ${center + contentSize * 0.35} ${center} ${center + contentSize * 0.35} 
             C${center} ${center + contentSize * 0.35} ${center - contentSize * 0.24} ${center + contentSize * 0.24} ${center - contentSize * 0.24} ${center + contentSize * 0.06} 
             L${center - contentSize * 0.24} ${center - contentSize * 0.15} Z" 
          fill="#061224" 
          stroke="#06b6d4" 
          stroke-width="${size * 0.007}" 
          opacity="0.85"/>
  </g>

  <!-- Quantum Chevron Sentinel Wings -->
  <g stroke="#38bdf8" stroke-width="${size * 0.01}" stroke-linecap="round" fill="none" opacity="0.9">
    <path d="M${center - contentSize * 0.18} ${center - contentSize * 0.04} L${center} ${center - contentSize * 0.14} L${center + contentSize * 0.18} ${center - contentSize * 0.04}"/>
    <path d="M${center - contentSize * 0.14} ${center + contentSize * 0.04} L${center} ${center - contentSize * 0.05} L${center + contentSize * 0.14} ${center + contentSize * 0.04}"/>
  </g>

  <!-- Central Fusion Energy Reactor (Node) -->
  <g filter="url(#intenseGlow)">
    <circle cx="${center}" cy="${center + contentSize * 0.12}" r="${contentSize * 0.09}" fill="url(#reactorCore)"/>
    <circle cx="${center}" cy="${center + contentSize * 0.12}" r="${contentSize * 0.04}" fill="#ffffff"/>
  </g>

  <!-- Crosshairs / Targeting Reticle Lines -->
  <g stroke="#ffffff" stroke-width="${size * 0.006}" stroke-linecap="round" opacity="0.8">
    <line x1="${center}" y1="${center + contentSize * 0.05}" x2="${center}" y2="${center + contentSize * 0.08}"/>
    <line x1="${center}" y1="${center + contentSize * 0.16}" x2="${center}" y2="${center + contentSize * 0.19}"/>
    <line x1="${center - contentSize * 0.07}" y1="${center + contentSize * 0.12}" x2="${center - contentSize * 0.04}" y2="${center + contentSize * 0.12}"/>
    <line x1="${center + contentSize * 0.04}" y1="${center + contentSize * 0.12}" x2="${center + contentSize * 0.07}" y2="${center + contentSize * 0.12}"/>
  </g>
</svg>`;
}

// CRC32 implementation for valid PNG writing
function makeCrcTable() {
  let c;
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  return crcTable;
}

const crcTable = makeCrcTable();
function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function writePngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crcTarget = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcVal = crc32(crcTarget);
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

// Generate valid binary PNG file
function generatePngBuffer(width, height) {
  const header = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR: 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(6, 9);   // color type 6: RGBA
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace
  const ihdrChunk = writePngChunk('IHDR', ihdrData);

  // Raw Image Data (with filter byte 0 at start of each scanline)
  const rawBytes = Buffer.alloc(height * (1 + width * 4));
  const cx = width / 2;
  const cy = height / 2;
  const maxR = width / 2;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawBytes[offset++] = 0; // Filter: None
    const dy = y - cy;

    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normDist = dist / maxR;

      let r = 7, g = 10, b = 20, a = 255; // Dark obsidian base

      // Radial dark vignette
      const bgGrad = Math.max(0, 1 - normDist * 0.9);
      r = Math.floor(6 + bgGrad * 12);
      g = Math.floor(10 + bgGrad * 18);
      b = Math.floor(22 + bgGrad * 35);

      // Central Shield Shape
      const shieldY = (y - cy) / (height * 0.4);
      const shieldX = Math.abs(x - cx) / (width * 0.35);
      
      const inShield = (shieldY >= -0.8 && shieldY <= 0.9) && 
        (shieldY <= 0.1 ? shieldX <= 0.85 : shieldX <= 0.85 * (1 - (shieldY - 0.1) / 0.8));

      if (inShield) {
        // Metallic cyan / slate fill
        const sheen = Math.max(0, 1 - shieldX * 1.1);
        r = Math.floor(6 + sheen * 28);
        g = Math.floor(18 + sheen * 130);
        b = Math.floor(36 + sheen * 180);

        // Border edge
        const isBorder = (shieldY <= -0.72 || shieldX >= 0.75 || (shieldY > 0.1 && shieldX >= 0.75 * (1 - (shieldY - 0.1) / 0.8)));
        if (isBorder) {
          r = 34;
          g = 211;
          b = 238; // Neon Cyan #22d3ee
        }
      }

      // Reactor Core Glowing Orb at center
      const coreDist = Math.sqrt(dx * dx + (dy - height * 0.08) * (dy - height * 0.08));
      const coreR = width * 0.1;
      if (coreDist < coreR) {
        const glow = 1 - (coreDist / coreR);
        r = Math.min(255, Math.floor(r + glow * 255));
        g = Math.min(255, Math.floor(g + glow * 240));
        b = Math.min(255, Math.floor(b + glow * 255));
      } else if (coreDist < coreR * 2.2) {
        // Outer aura
        const aura = 1 - ((coreDist - coreR) / (coreR * 1.2));
        r = Math.min(255, Math.floor(r + aura * 30));
        g = Math.min(255, Math.floor(g + aura * 140));
        b = Math.min(255, Math.floor(b + aura * 220));
      }

      rawBytes[offset++] = r;
      rawBytes[offset++] = g;
      rawBytes[offset++] = b;
      rawBytes[offset++] = a;
    }
  }

  // Deflate compressed IDAT
  const compressed = zlib.deflateSync(rawBytes, { level: 9 });
  const idatChunk = writePngChunk('IDAT', compressed);

  // IEND
  const iendChunk = writePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Generate all assets
const iconsDir = path.join(process.cwd(), 'public', 'icons');
const publicDir = path.join(process.cwd(), 'public');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 1. High-Resolution SVGs
fs.writeFileSync(path.join(iconsDir, 'icon-192.svg'), generateSvgIcon(192, false));
fs.writeFileSync(path.join(iconsDir, 'icon-512.svg'), generateSvgIcon(512, false));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-512.svg'), generateSvgIcon(512, true));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-192.svg'), generateSvgIcon(192, true));
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.svg'), generateSvgIcon(180, false));
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), generateSvgIcon(64, false));

// 2. High-Resolution Valid Binary PNGs
const png192 = generatePngBuffer(192, 192);
const png512 = generatePngBuffer(512, 512);
const png180 = generatePngBuffer(180, 180);

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), png192);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), png512);
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), png180);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180);

console.log('[PWA Icon Generator] Generated consistent high-resolution icon set successfully!');
