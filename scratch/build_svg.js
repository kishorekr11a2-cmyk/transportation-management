const fs = require("fs");
const path = require("path");

// Color Palette Constants
const COLORS = {
    bgDark: "#061024",
    bgGrid: "#0c1e3d",
    panelBg: "#0b1b38",
    panelBorder: "#1e3a6a",
    panelHeaderBg: "#11264c",
    textWhite: "#ffffff",
    textMuted: "#94a3b8",
    textCyan: "#38bdf8",
    textBlue: "#60a5fa",
    pillBlue: "#2563eb",
    cardBg: "#ffffff",
    cardBorder: "#cbd5e1",
    cardTitle: "#0f172a",
    cardSub: "#2563eb",
    cardBody: "#334155",
    cardNote: "#64748b",
    accentEmerald: "#059669",
    accentAmber: "#d97706",
    accentRose: "#e11d48",
    accentPurple: "#7c3aed",
    accentSky: "#0284c7",
    accentIndigo: "#4f46e5",
    arrowHttp: "#38bdf8",
    arrowOpt: "#f59e0b",
    arrowDb: "#10b981",
    arrowExt: "#a855f7",
    arrowLate: "#f43f5e"
};

// SVG Path Icons
const ICONS = {
    admin: `<path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zm-7 15a7 7 0 0 1 14 0v1H5v-1zm9.5-12.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="#2563eb"/>`,
    student: `<path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm0 8.5L4.5 8 12 4.14 19.5 8 12 11.5zM6 13.5v3.67C7.6 18.23 9.7 19 12 19s4.4-.77 6-1.83v-3.67c-1.6 1.06-3.7 1.83-6 1.83s-4.4-.77-6-1.83z" fill="#0284c7"/>`,
    react: `<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0-8c5.52 0 10 2.24 10 5s-4.48 5-10 5S2 9.76 2 7s4.48-5 10-5zm0 14c-5.52 0-10-2.24-10-5s4.48-5 10-5 10 2.24 10 5-4.48 5-10 5z" fill="#0284c7"/>`,
    dashboard: `<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="#2563eb"/>`,
    bus: `<path d="M4 16c0 1.1.9 2 2 2v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h6v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1c1.1 0 2-.9 2-2V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z" fill="#d97706"/>`,
    route: `<path d="M19 15.18V7c0-2.21-1.79-4-4-4s-4 1.79-4 4v10c0 1.1-.9 2-2 2s-2-.9-2-2V8.82C8.16 8.4 9 7.3 9 6c0-1.66-1.34-3-3-3S3 4.34 3 6c0 1.3.84 2.4 2 2.82V17c0 2.21 1.79 4 4 4s4-1.79 4-4V7c0-1.1.9-2 2-2s2 .9 2 2v8.18c-1.16.41-2 1.51-2 2.82 0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.3-.84-2.4-2-2.82z" fill="#059669"/>`,
    clock: `<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z" fill="#7c3aed"/>`,
    aiBrain: `<path d="M12 3a9 9 0 0 0-9 9c0 3.6 2.1 6.7 5.2 8.1l.8-1.8C6.3 17.2 4.6 14.8 4.6 12a7.4 7.4 0 0 1 7.4-7.4c4.1 0 7.4 3.3 7.4 7.4 0 2.8-1.7 5.2-4.4 6.3l.8 1.8c3.1-1.4 5.2-4.5 5.2-8.1a9 9 0 0 0-9-9zm-1 5v4.6l3.5 2.1.8-1.3-2.8-1.7V8h-1.5z" fill="#4f46e5"/>`,
    checkCircle: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#059669"/>`,
    edit: `<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#2563eb"/>`,
    excel: `<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm1 8h4.5L14 4.5V10zm-6.2 8.5L7.3 16l1.5-2.5h1.6l-2.2 3.2 2.3 3.3H8.8l-1.5-2.5z" fill="#059669"/>`,
    bell: `<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" fill="#0284c7"/>`,
    server: `<path d="M4 4h16v4H4V4zm0 6h16v4H4v-4zm0 6h16v4H4v-4zm2-10h2V6H6V6zm0 6h2v-2H6v2zm0 6h2v-2H6v2z" fill="#0284c7"/>`,
    database: `<path d="M12 2C6.48 2 2 4.01 2 6.5v11C2 19.99 6.48 22 12 22s10-2.01 10-4.5v-11C22 4.01 17.52 2 12 2zm0 2c4.42 0 8 1.57 8 2.5S16.42 9 12 9s-8-1.57-8-2.5S7.58 4 12 4zm8 13.5c0 .93-3.58 2.5-8 2.5s-8-1.57-8-2.5V14.8c1.9 1.1 4.8 1.7 8 1.7s6.1-.6 8-1.7v2.7zm0-4.5c0 .93-3.58 2.5-8 2.5s-8-1.57-8-2.5V10.3c1.9 1.1 4.8 1.7 8 1.7s6.1-.6 8-1.7V13z" fill="#10b981"/>`,
    map: `<path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" fill="#d97706"/>`,
    whatsapp: `<path d="M16.75 13.96c.25.13.41.2.46.3.06.11.04.61-.21 1.18-.25.56-.96 1.09-1.63 1.25-.56.13-1.19.16-3.41-.62-2.31-.81-4.04-2.88-4.22-3.11-.19-.23-1.42-1.89-1.42-3.6 0-1.72.9-2.57 1.22-2.92.32-.36.71-.45.95-.45.24 0 .48 0 .69.01.23.01.53-.09.83.63.31.74 1.06 2.58 1.15 2.77.1.19.16.42.04.66-.13.23-.2.37-.39.6-.19.23-.41.51-.58.69-.2.2-.4.42-.18.8.23.38 1.01 1.67 2.18 2.7 1.5 1.34 2.76 1.75 3.16 1.95.4.19.63.16.86-.1.23-.27.99-1.15 1.25-1.55.26-.4.52-.33.87-.2zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#10b981"/>`,
    filter: `<path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" fill="#2563eb"/>`,
    lightning: `<path d="M7 2v11h3v9l7-12h-4l4-8H7z" fill="#f59e0b"/>`,
    gears: `<path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" fill="#0284c7"/>`
};

// Helper: render a white component card
function renderWhiteCard({
    x, y, w, h,
    title,
    badge,
    bullet1,
    bullet2,
    bullet3,
    iconSvg,
    topAccent = COLORS.cardSub,
    badgeColor = COLORS.cardSub
}) {
    const isShort = h <= 85;
    return `
    <!-- Card: ${escapeXml(title)} -->
    <g transform="translate(${x}, ${y})">
        <!-- Card Background -->
        <rect width="${w}" height="${h}" rx="8" ry="8" fill="${COLORS.cardBg}" stroke="${COLORS.cardBorder}" stroke-width="1.3" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>
        <!-- Top Accent Bar -->
        <path d="M 0 8 Q 0 0 8 0 L ${w - 8} 0 Q ${w} 0 ${w} 8 L ${w} 4 L 0 4 Z" fill="${topAccent}"/>
        
        <!-- Icon Container -->
        <g transform="translate(12, ${isShort ? 10 : 14})">
            <rect width="26" height="26" rx="5" ry="5" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="1"/>
            <g transform="translate(1, 1) scale(1)">
                <svg width="24" height="24" viewBox="0 0 24 24">${iconSvg}</svg>
            </g>
        </g>
        
        <!-- Title & Badge -->
        <text x="46" y="${isShort ? 20 : 24}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${isShort ? 12 : 12.5}" font-weight="700" fill="${COLORS.cardTitle}">${escapeXml(title)}</text>
        ${badge ? `
        <rect x="46" y="${isShort ? 25 : 28}" width="${Math.min(badge.length * 6.5 + 14, w - 55)}" height="${isShort ? 14 : 15}" rx="3" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="0.8"/>
        <text x="53" y="${isShort ? 35.5 : 39}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${isShort ? 9 : 9.5}" font-weight="600" fill="${badgeColor}">${escapeXml(badge)}</text>
        ` : ''}

        <!-- Bullets -->
        <g transform="translate(14, ${badge ? (isShort ? 45 : 55) : 48})">
            ${bullet1 ? `
            <circle cx="2" cy="${isShort ? 3 : 4}" r="2" fill="${topAccent}"/>
            <text x="10" y="${isShort ? 6.5 : 7.5}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${isShort ? 9.6 : 10.2}" fill="${COLORS.cardBody}">${escapeXml(bullet1)}</text>
            ` : ''}
            ${bullet2 ? `
            <circle cx="2" cy="${isShort ? 17 : 19}" r="2" fill="${topAccent}"/>
            <text x="10" y="${isShort ? 20.5 : 22.5}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${isShort ? 9.6 : 10.2}" fill="${COLORS.cardBody}">${escapeXml(bullet2)}</text>
            ` : ''}
            ${bullet3 ? `
            <circle cx="2" cy="34" r="2" fill="${topAccent}"/>
            <text x="10" y="37.5" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="${COLORS.cardNote}">${escapeXml(bullet3)}</text>
            ` : ''}
        </g>
    </g>`;
}

// Helper: render a lifecycle step card (in Section 7)
function renderLifecycleCard({
    x, y, w, h,
    stepNum,
    title,
    actor,
    desc,
    note,
    topAccent = COLORS.pillBlue
}) {
    return `
    <g transform="translate(${x}, ${y})">
        <rect width="${w}" height="${h}" rx="8" ry="8" fill="${COLORS.cardBg}" stroke="${COLORS.cardBorder}" stroke-width="1.3" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>
        <path d="M 0 8 Q 0 0 8 0 L ${w - 8} 0 Q ${w} 0 ${w} 8 L ${w} 4 L 0 4 Z" fill="${topAccent}"/>
        
        <!-- Step Number Badge -->
        <rect x="12" y="12" width="28" height="24" rx="4" fill="${topAccent}"/>
        <text x="26" y="28" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" fill="#ffffff" text-anchor="middle">${stepNum}</text>
        
        <!-- Title & Actor -->
        <text x="48" y="22" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12.5" font-weight="700" fill="${COLORS.cardTitle}">${escapeXml(title)}</text>
        <text x="48" y="35" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="600" fill="${topAccent}">${escapeXml(actor)}</text>

        <!-- Description & Note -->
        <text x="14" y="58" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="10.2" fill="${COLORS.cardBody}">${escapeXml(desc)}</text>
        ${note ? `<text x="14" y="73" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="500" fill="${COLORS.cardNote}">${escapeXml(note)}</text>` : ''}
    </g>`;
}

// XML Escaping
function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

// Helper: render panel container with section header
function renderPanel({ x, y, w, h, num, title, subtitle }) {
    return `
    <!-- Panel: Section ${num} -->
    <g transform="translate(${x}, ${y})">
        <rect width="${w}" height="${h}" rx="10" ry="10" fill="${COLORS.panelBg}" stroke="${COLORS.panelBorder}" stroke-width="1.6"/>
        <!-- Panel Header -->
        <path d="M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 42 L 0 42 Z" fill="${COLORS.panelHeaderBg}"/>
        <line x1="0" y1="42" x2="${w}" y2="42" stroke="${COLORS.panelBorder}" stroke-width="1.2"/>
        
        <!-- Number Pill -->
        <rect x="14" y="10" width="30" height="22" rx="4" fill="${COLORS.pillBlue}"/>
        <text x="29" y="25" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" fill="#ffffff" text-anchor="middle">${num}</text>
        
        <!-- Header Text -->
        <text x="52" y="23" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="14.5" font-weight="700" fill="${COLORS.textBlue}">${escapeXml(title)}</text>
        <text x="52" y="36" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="10.5" fill="${COLORS.textMuted}">${escapeXml(subtitle)}</text>
    </g>`;
}

function buildSystemArchitectureSvg() {
    let svg = `<svg width="2600" height="1620" viewBox="0 0 2600 1620" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <!-- Marker Arrows -->
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${COLORS.arrowHttp}"/>
        </marker>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${COLORS.arrowOpt}"/>
        </marker>
        <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${COLORS.arrowDb}"/>
        </marker>
        <marker id="arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${COLORS.arrowExt}"/>
        </marker>
        <marker id="arrow-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${COLORS.arrowLate}"/>
        </marker>
        
        <!-- Canvas Grid Pattern -->
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${COLORS.bgGrid}" stroke-width="0.8" opacity="0.6"/>
        </pattern>
    </defs>

    <!-- Master Background -->
    <rect width="2600" height="1620" fill="${COLORS.bgDark}"/>
    <rect width="2600" height="1620" fill="url(#grid)"/>

    <!-- ====================================================================== -->
    <!-- TOP HEADER BANNER                                                      -->
    <!-- ====================================================================== -->
    <g transform="translate(40, 20)">
        <rect width="2520" height="88" rx="8" fill="#091836" stroke="#1d3b70" stroke-width="1.8"/>
        
        <!-- Project Title & Subtitle -->
        <text x="24" y="38" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#ffffff" letter-spacing="0.5">AI-BASED TRANSPORTATION MANAGEMENT SYSTEM</text>
        <text x="24" y="62" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="${COLORS.textCyan}">High-Level System Architecture, Component Topography &amp; Operational Lifecycle | Final Year B.E. Project</text>
        
        <!-- System Status Pills -->
        <g transform="translate(1420, 26)">
            <!-- Pill 1: Optimization Runtime -->
            <rect x="0" y="0" width="310" height="34" rx="6" fill="#062922" stroke="#059669" stroke-width="1.2"/>
            <circle cx="16" cy="17" r="5" fill="#10b981"/>
            <text x="30" y="21.5" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#34d399">MODE: DETERMINISTIC_HEURISTIC_OPTIMIZER</text>
            
            <!-- Pill 2: Mathematical Safety -->
            <rect x="325" y="0" width="235" height="34" rx="6" fill="#2d1c03" stroke="#d97706" stroke-width="1.2"/>
            <circle cx="341" cy="17" r="5" fill="#f59e0b"/>
            <text x="355" y="21.5" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#fbbf24">ZERO PASSENGER LOSS SAFE</text>

            <!-- Pill 3: Direct WhatsApp -->
            <rect x="575" y="0" width="225" height="34" rx="6" fill="#062922" stroke="#10b981" stroke-width="1.2"/>
            <circle cx="591" cy="17" r="5" fill="#34d399"/>
            <text x="605" y="21.5" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#6ee7b7">DIRECT BAILEYS WEBSOCKET</text>

            <!-- Pill 4: Road Matrix Engine -->
            <rect x="815" y="0" width="265" height="34" rx="6" fill="#1e1438" stroke="#7c3aed" stroke-width="1.2"/>
            <circle cx="831" cy="17" r="5" fill="#a78bfa"/>
            <text x="845" y="21.5" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#c4b5fd">OSRM ROAD NETWORK MATRIX</text>
        </g>
    </g>

    <!-- ====================================================================== -->
    <!-- ROW 1: SECTION 1 (USERS) & SECTION 2 (FRONTEND)                        -->
    <!-- ====================================================================== -->

    <!-- SECTION 1: USERS & ACTORS -->
    ${renderPanel({
        x: 40, y: 120, w: 340, h: 365,
        num: "01",
        title: "USERS & ACTORS",
        subtitle: "Primary human stakeholders & role-based portals"
    })}

    ${renderWhiteCard({
        x: 60, y: 175, w: 300, h: 140,
        title: "Administrator / Transport Lead",
        badge: "ROLE: ADMIN | JWT AUTHENTICATED",
        bullet1: "Oversees fleet capacities & inward starting depots",
        bullet2: "Generates AI optimization plans & reviews proposals",
        bullet3: "Activates live plans, manages late queue & broadcasts",
        iconSvg: ICONS.admin,
        topAccent: COLORS.pillBlue,
        badgeColor: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 60, y: 328, w: 300, h: 140,
        title: "Student / Daily Commuter",
        badge: "ROLE: STUDENT | ID & PHONE LOGIN",
        bullet1: "Daily travel status submission (Coming / Not Coming)",
        bullet2: "Views allocated bus number, designated stop & time",
        bullet3: "Receives WhatsApp boarding alerts & live notifications",
        iconSvg: ICONS.student,
        topAccent: COLORS.accentSky,
        badgeColor: COLORS.accentSky
    })}

    <!-- SECTION 2: FRONTEND PRESENTATION LAYER (REACT 18 + VITE) -->
    ${renderPanel({
        x: 400, y: 120, w: 2160, h: 365,
        num: "02",
        title: "FRONTEND PRESENTATION LAYER (REACT 18 + VITE)",
        subtitle: "Single Page Application (SPA), React Router v6, Axios REST client, Leaflet Map engine, and Hot Toast notifications"
    })}

    <!-- Row A: 6 Cards -->
    ${renderWhiteCard({
        x: 425, y: 175, w: 335, h: 140,
        title: "Authentication & Role Router",
        badge: "AdminLogin.jsx | StudentLogin.jsx",
        bullet1: "JWT bearer token storage & state persistence",
        bullet2: "Role-based route guarding (Admin vs Student)",
        bullet3: "Public landing hub & session expiry interceptors",
        iconSvg: ICONS.react,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 780, y: 175, w: 335, h: 140,
        title: "Admin Operations Dashboard",
        badge: "AdminDashboard.jsx",
        bullet1: "Real-time fleet KPI metrics & active vehicles",
        bullet2: "Confirmed commuter count vs fleet capacity",
        bullet3: "Live unallocated student indicator & quick links",
        iconSvg: ICONS.dashboard,
        topAccent: COLORS.accentSky
    })}

    ${renderWhiteCard({
        x: 1135, y: 175, w: 335, h: 140,
        title: "User Management Module",
        badge: "UserManagement.jsx",
        bullet1: "Student & faculty directory with CRUD controls",
        bullet2: "Real-time travelStatus monitor (Coming / Not)",
        bullet3: "Registered phone verification for WhatsApp",
        iconSvg: ICONS.admin,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 1490, y: 175, w: 335, h: 140,
        title: "Vehicle Fleet Management",
        badge: "VehicleManagement.jsx",
        bullet1: "Bus inventory, seating capacity (Cap_v) & status",
        bullet2: "Vehicle availability toggles for active scheduling",
        bullet3: "Driver credentials & registration assignment",
        iconSvg: ICONS.bus,
        topAccent: COLORS.accentAmber
    })}

    ${renderWhiteCard({
        x: 1845, y: 175, w: 335, h: 140,
        title: "Route Management & Polyline",
        badge: "RouteManagement.jsx",
        bullet1: "Interactive Leaflet & OpenStreetMap visualizer",
        bullet2: "Stops ordering, drag-and-drop waypoint sequence",
        bullet3: "Road polylines, direction selector (INWARD/OUTWARD)",
        iconSvg: ICONS.route,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2200, y: 175, w: 335, h: 140,
        title: "Schedule & Shift Timetables",
        badge: "ScheduleManagement.jsx",
        bullet1: "Morning pickup shifts & evening return departure times",
        bullet2: "Operational time windows & shift configurations",
        bullet3: "Calendar date scheduling & active shift toggles",
        iconSvg: ICONS.clock,
        topAccent: COLORS.accentPurple
    })}

    <!-- Row B: 6 Cards -->
    ${renderWhiteCard({
        x: 425, y: 328, w: 335, h: 142,
        title: "AI Agent Optimization Studio",
        badge: "AIAgent.jsx",
        bullet1: "Multi-objective combinatorial parameter tuning",
        bullet2: "Dry-run optimization preview with road metrics",
        bullet3: "Direction-specific plan reset & diagnostic logs",
        iconSvg: ICONS.aiBrain,
        topAccent: COLORS.accentIndigo
    })}

    ${renderWhiteCard({
        x: 780, y: 328, w: 335, h: 142,
        title: "Plan Confirmation & Activation",
        badge: "PlanConfirmation.jsx",
        bullet1: "Side-by-side proposed bus route inspection",
        bullet2: "Detailed passenger manifest per vehicle",
        bullet3: "One-click 'Approve & Activate' atomic execution",
        iconSvg: ICONS.checkCircle,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 1135, y: 328, w: 335, h: 142,
        title: "Admin Manual Plan Editor",
        badge: "AdminManualPlan.jsx",
        bullet1: "Administrative manual route configuration",
        bullet2: "AI vehicle suitability & capacity guidance",
        bullet3: "Deterministic zero-passenger-loss validation",
        iconSvg: ICONS.edit,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 1490, y: 328, w: 335, h: 142,
        title: "Student Commuter Dashboard",
        badge: "StudentDashboard.jsx",
        bullet1: "Instant daily travel status toggle (Coming / Not)",
        bullet2: "Assigned bus number, stop location & timetable",
        bullet3: "Late responder status notice: WAITING FOR REVIEW",
        iconSvg: ICONS.student,
        topAccent: COLORS.accentSky
    })}

    ${renderWhiteCard({
        x: 1845, y: 328, w: 335, h: 142,
        title: "Excel Bulk Ingestion Portal",
        badge: "ExcelUpload.jsx | ImportExcel.jsx",
        bullet1: "Drag-and-drop .xlsx/.xls workbook batch parsing",
        bullet2: "Multi-column student & stop record mapping",
        bullet3: "Instantaneous database upsert of 400+ commuters",
        iconSvg: ICONS.excel,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2200, y: 328, w: 335, h: 142,
        title: "Automation & WhatsApp Hub",
        badge: "Automation.jsx",
        bullet1: "Triggers travel status reminder broadcasts",
        bullet2: "Monitors n8n webhook status & Baileys socket",
        bullet3: "Execution summary: Sent, Skipped, and Failed",
        iconSvg: ICONS.bell,
        topAccent: COLORS.accentPurple
    })}

    <!-- ====================================================================== -->
    <!-- ROW 2: SECTION 3 (BACKEND), SECTION 4 (AI ENGINE), SECTION 6 (SERVICES)-->
    <!-- ====================================================================== -->

    <!-- SECTION 3: BACKEND APPLICATION LAYER (NODE.JS + EXPRESS 5) -->
    ${renderPanel({
        x: 40, y: 500, w: 800, h: 395,
        num: "03",
        title: "BACKEND APPLICATION & API LAYER (NODE.JS + EXPRESS 5)",
        subtitle: "REST API Gateway, Performance Timing, Controllers, and Service Orchestration"
    })}

    <!-- Backend Row A: 3 Cards -->
    ${renderWhiteCard({
        x: 65, y: 555, w: 236, h: 150,
        title: "Express 5 REST API Gateway",
        badge: "server.js | authRoutes.js",
        bullet1: "JWT verification & RBAC middleware",
        bullet2: "Performance timing for key endpoints",
        bullet3: "Cache-Control: no-store on all APIs",
        iconSvg: ICONS.server,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 322, y: 555, w: 236, h: 150,
        title: "Resource Controllers",
        badge: "userRoutes, vehicleRoutes, etc.",
        bullet1: "CRUD operations for core domain models",
        bullet2: "Travel-status toggle endpoint handler",
        bullet3: "Inward starting depot configuration",
        iconSvg: ICONS.gears,
        topAccent: COLORS.accentSky
    })}

    ${renderWhiteCard({
        x: 579, y: 555, w: 236, h: 150,
        title: "Excel Ingestion Engine",
        badge: "excelRoutes.js | Multer + xlsx",
        bullet1: "In-memory multipart spreadsheet buffer",
        bullet2: "Validates columns, coordinates & phones",
        bullet3: "Atomic batch insertion into MongoDB",
        iconSvg: ICONS.excel,
        topAccent: COLORS.accentEmerald
    })}

    <!-- Backend Row B: 3 Cards -->
    ${renderWhiteCard({
        x: 65, y: 720, w: 236, h: 160,
        title: "AI Agent Orchestrator",
        badge: "aiAgentService.js",
        bullet1: "Demand aggregation for Coming riders",
        bullet2: "Coordinates dry-run routing pipeline",
        bullet3: "Directional filtering (INWARD/OUTWARD)",
        iconSvg: ICONS.aiBrain,
        topAccent: COLORS.accentIndigo
    })}

    ${renderWhiteCard({
        x: 322, y: 720, w: 236, h: 160,
        title: "Plan Activation Engine",
        badge: "activate_live_plan.js",
        bullet1: "Transitions AiPlan: draft -> active",
        bullet2: "Atomic update of User.assignedBus",
        bullet3: "Writes telemetry to RoutePerformance",
        iconSvg: ICONS.checkCircle,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 579, y: 720, w: 236, h: 160,
        title: "Late-Response Controller",
        badge: "lateResponseLifecycleService.js",
        bullet1: "Detects late status change post-approval",
        bullet2: "Logs quarantined LateResponseEvent",
        bullet3: "lateResponseRegenerationService.js",
        iconSvg: ICONS.bell,
        topAccent: COLORS.accentRose,
        badgeColor: COLORS.accentRose
    })}

    <!-- SECTION 4: AI COMBINATORIAL ROUTE OPTIMIZATION ENGINE -->
    ${renderPanel({
        x: 860, y: 500, w: 1140, h: 395,
        num: "04",
        title: "AI COMBINATORIAL ROUTE OPTIMIZATION ENGINE",
        subtitle: "Multi-objective combinatorial heuristics, OSRM road matrices, Clarke-Wright savings, and 2-opt local search"
    })}

    <!-- Row A: 4 Pipeline Cards -->
    ${renderWhiteCard({
        x: 885, y: 555, w: 255, h: 150,
        title: "1. Confirmed Demand Filter",
        badge: "STRICT STATUS ISOLATION",
        bullet1: "Extracts users with travelStatus == 'Coming'",
        bullet2: "Ignores Not Coming & Pending students",
        bullet3: "Resolves boarding stop WGS-84 coordinates",
        iconSvg: ICONS.filter,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 1160, y: 555, w: 255, h: 150,
        title: "2. Fleet Capacity Validation",
        badge: "BOUNDS & DEPOT ANCHORS",
        bullet1: "Queries available fleet & capacities (Cap_v)",
        bullet2: "Retrieves inward starting depot per bus",
        bullet3: "Verifies total seat capacity >= demand",
        iconSvg: ICONS.bus,
        topAccent: COLORS.accentAmber
    })}

    ${renderWhiteCard({
        x: 1435, y: 555, w: 255, h: 150,
        title: "3. Road Distance Matrix",
        badge: "OSRM TABLE API + CACHE",
        bullet1: "Real-world driving distance & travel time",
        bullet2: "Asymmetric road network calculations",
        bullet3: "Two-tier TTL cache eliminates latency",
        iconSvg: ICONS.map,
        topAccent: COLORS.accentSky
    })}

    ${renderWhiteCard({
        x: 1710, y: 555, w: 265, h: 150,
        title: "4. Geocoding Resolution",
        badge: "NOMINATIM OSM ENGINE",
        bullet1: "Forward & reverse geocoding of stops",
        bullet2: "Normalizes landmarks to exact lat/lon",
        bullet3: "MongoDB mapLocation caching layer",
        iconSvg: ICONS.route,
        topAccent: COLORS.accentEmerald
    })}

    <!-- Pipeline connecting arrows in Section 4 Row A -->
    <path d="M 1140 630 L 1155 630" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <path d="M 1415 630 L 1430 630" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <path d="M 1690 630 L 1705 630" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <path d="M 1975 690 L 1985 690 L 1985 712 L 872 712 L 872 795 L 880 795" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="1.8" stroke-dasharray="3,2" marker-end="url(#arrow-amber)"/>

    <!-- Row B: 3 Optimization Cards -->
    ${renderWhiteCard({
        x: 885, y: 720, w: 350, h: 160,
        title: "5. Clarke-Wright Road Savings",
        badge: "MIN-HEAP PRIORITY QUEUE O(log K)",
        bullet1: "Calculates road savings: S_ij = C_0i + C_0j - C_ij",
        bullet2: "Fastest extraction of top savings pairs via Min-Heap",
        bullet3: "Greedy clustering constrained by vehicle capacity (Cap_v)",
        iconSvg: ICONS.lightning,
        topAccent: COLORS.accentAmber
    })}

    ${renderWhiteCard({
        x: 1255, y: 720, w: 360, h: 160,
        title: "6. 2-Opt Road Sequence Search",
        badge: "EDGE-EXCHANGE UNTANGLING",
        bullet1: "Swaps non-adjacent road segments whenever delta < 0",
        bullet2: "Eliminates zig-zags, backtracking, and road loops",
        bullet3: "Inter-route operators: Relocate, Exchange, and Or-opt",
        iconSvg: ICONS.route,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 1635, y: 720, w: 340, h: 160,
        title: "7. Scoring & Deterministic Zero-Loss",
        badge: "MATHEMATICAL SAFETY ASSURANCE",
        bullet1: "Scoring: Utilization (85-100%) + Jaccard Co-occurrence",
        bullet2: "Zero passenger loss: All Coming commuters routed",
        bullet3: "Delayed fleet-wide assignment matches ideal bus capacity",
        iconSvg: ICONS.checkCircle,
        topAccent: COLORS.accentIndigo
    })}

    <!-- Pipeline connecting arrows in Section 4 Row B -->
    <path d="M 1235 795 L 1250 795" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <path d="M 1615 795 L 1630 795" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>

    <!-- SECTION 6: EXTERNAL SERVICES & INTEGRATIONS -->
    ${renderPanel({
        x: 2020, y: 500, w: 540, h: 395,
        num: "06",
        title: "EXTERNAL SERVICES & INTEGRATIONS",
        subtitle: "GIS routing engines, geocoders, messaging sockets, and automation webhooks"
    })}

    ${renderWhiteCard({
        x: 2045, y: 552, w: 490, h: 77,
        title: "OSRM Routing Engine (Open Source Routing Machine)",
        badge: "HTTP TABLE & ROUTE APIs",
        bullet1: "Table API: duration & distance matrix | Route API: road polylines",
        bullet2: "High-performance C++ driving profile routing daemon",
        iconSvg: ICONS.map,
        topAccent: COLORS.accentSky
    })}

    ${renderWhiteCard({
        x: 2045, y: 634, w: 490, h: 77,
        title: "Nominatim Geocoding API (OpenStreetMap)",
        badge: "OSM GEOCODING SERVICE",
        bullet1: "Resolves institution stop names and addresses to WGS-84 coordinates",
        bullet2: "Provides geographic polygon boundaries & reverse geocode lookup",
        iconSvg: ICONS.route,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2045, y: 716, w: 490, h: 77,
        title: "WhatsApp Multi-Device Engine (@whiskeysockets/baileys)",
        badge: "EMBEDDED WEBSOCKET SOCKET",
        bullet1: "Direct connection to WhatsApp servers without paid third-party APIs",
        bullet2: "QR terminal auth, auto-reconnect backoff & E.164 phone normalization",
        iconSvg: ICONS.whatsapp,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2045, y: 798, w: 490, h: 77,
        title: "Spreadsheet Parser (xlsx) & n8n Automation Webhook",
        badge: "XLSX PARSER | OPTIONAL n8n RUNNER AT PORT 5678",
        bullet1: "xlsx: Fast in-memory parsing of commuter spreadsheets via Multer",
        bullet2: "n8n Webhook: Optional scheduled batch runner calling /api/whatsapp/send",
        iconSvg: ICONS.excel,
        topAccent: COLORS.accentPurple
    })}

    <!-- ====================================================================== -->
    <!-- ROW 3: SECTION 7 (PLAN LIFECYCLE) & SECTION 5 (MONGODB PERSISTENCE)    -->
    <!-- ====================================================================== -->

    <!-- SECTION 7: TRANSPORTATION PLAN LIFECYCLE & OPERATIONAL WORKFLOW -->
    ${renderPanel({
        x: 40, y: 915, w: 1510, h: 565,
        num: "07",
        title: "TRANSPORTATION PLAN LIFECYCLE & OPERATIONAL WORKFLOW",
        subtitle: "Verified end-to-end operational lifecycle: from daily status submission to approval, late isolation, and regeneration"
    })}

    <!-- 9 Sequential Steps arranged in a clean 3x3 layout -->
    <!-- Row 1 of Lifecycle -->
    ${renderLifecycleCard({
        x: 65, y: 970, w: 465, h: 150,
        stepNum: "1",
        title: "Student Travel-Status Submission",
        actor: "ACTOR: STUDENT COMMUTER",
        desc: "Commuters toggle travelStatus ('Coming' / 'Not Coming') via Student Dashboard before the operational cutoff window.",
        note: "Updates User.travelStatus; resets old bus allocation.",
        topAccent: COLORS.pillBlue
    })}

    ${renderLifecycleCard({
        x: 560, y: 970, w: 465, h: 150,
        stepNum: "2",
        title: "Demand Snapshot & Confirmed Filtering",
        actor: "ACTOR: BACKEND AI ORCHESTRATOR",
        desc: "System filters active students where travelStatus == 'Coming'. Non-traveling and pending students are safely excluded.",
        note: "Stops are resolved, geocoded, and aggregated into demand clusters.",
        topAccent: COLORS.accentSky
    })}

    ${renderLifecycleCard({
        x: 1055, y: 970, w: 465, h: 150,
        stepNum: "3",
        title: "AI Route Optimization (Dry-Run)",
        actor: "ACTOR: COMBINATORIAL OPTIMIZATION ENGINE",
        desc: "Executes OSRM road matrix lookup, Clarke-Wright savings, and 2-opt untangling. Generates draft plan proposal in memory.",
        note: "Zero live database assignments modified during preview mode.",
        topAccent: COLORS.accentAmber
    })}

    <!-- Lifecycle Sequence Arrows: Row 1 -->
    <path d="M 530 1045 L 555 1045" fill="none" stroke="${COLORS.pillBlue}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>
    <path d="M 1025 1045 L 1050 1045" fill="none" stroke="${COLORS.pillBlue}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>
    <path d="M 1520 1045 L 1535 1045 L 1535 1130 L 50 1130 L 50 1210 L 60 1210" fill="none" stroke="${COLORS.pillBlue}" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arrow-blue)"/>

    <!-- Row 2 of Lifecycle -->
    ${renderLifecycleCard({
        x: 65, y: 1135, w: 465, h: 150,
        stepNum: "4",
        title: "Administrator Review & Approval",
        actor: "ACTOR: TRANSPORT ADMINISTRATOR",
        desc: "Admin inspects proposed routes, stop sequences, vehicle utilization, and manifests in Plan Confirmation. Approves proposal.",
        note: "AiPlan status transitions from 'draft' to 'approved'.",
        topAccent: COLORS.accentPurple
    })}

    ${renderLifecycleCard({
        x: 560, y: 1135, w: 465, h: 150,
        stepNum: "5",
        title: "Plan Live Activation & Seat Allocation",
        actor: "ACTOR: PLAN ACTIVATION ENGINE (activate_live_plan.js)",
        desc: "Atomic database transaction sets User.assignedBus, generates boarding manifests, and writes telemetry to RoutePerformance.",
        note: "AiPlan marked active; institutional fleet schedule goes live.",
        topAccent: COLORS.accentEmerald
    })}

    ${renderLifecycleCard({
        x: 1055, y: 1135, w: 465, h: 150,
        stepNum: "6",
        title: "Live Student Dashboard Display",
        actor: "ACTOR: COMMUTER / WHATSAPP SOCKET",
        desc: "Student Dashboard immediately reflects allocated bus number, designated stop, and schedule. WhatsApp alerts dispatched.",
        note: "Commuters receive real-time bus number & boarding timetable.",
        topAccent: COLORS.pillBlue
    })}

    <!-- Lifecycle Sequence Arrows: Row 2 -->
    <path d="M 530 1210 L 555 1210" fill="none" stroke="${COLORS.pillBlue}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>
    <path d="M 1025 1210 L 1050 1210" fill="none" stroke="${COLORS.pillBlue}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>
    <path d="M 1520 1210 L 1535 1210 L 1535 1295 L 50 1295 L 50 1375 L 60 1375" fill="none" stroke="${COLORS.accentAmber}" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arrow-amber)"/>

    <!-- Row 3 of Lifecycle -->
    ${renderLifecycleCard({
        x: 65, y: 1300, w: 465, h: 150,
        stepNum: "7",
        title: "Late Coming Response Quarantine",
        actor: "ACTOR: LATE-RESPONSE CONTROLLER",
        desc: "If student submits 'Coming' after plan approval, student is NOT injected into running route. Quarantined in LateResponseEvent.",
        note: "Student marked 'UNALLOCATED / WAITING'; event status = 'PENDING'.",
        topAccent: COLORS.accentRose
    })}

    ${renderLifecycleCard({
        x: 560, y: 1300, w: 465, h: 150,
        stepNum: "8",
        title: "AI Regeneration & Re-Approval",
        actor: "ACTOR: REGENERATION SERVICE & ADMIN",
        desc: "Admin inspects late queue. Triggers AI regeneration which checks vehicle spare seats, proposes revised plan, and admin re-approves.",
        note: "LateResponseEvent marked 'RESOLVED'; late student allocated.",
        topAccent: COLORS.accentAmber
    })}

    ${renderLifecycleCard({
        x: 1055, y: 1300, w: 465, h: 150,
        stepNum: "9",
        title: "Direction-Specific Plan Reset",
        actor: "ACTOR: TRANSPORT ADMINISTRATOR",
        desc: "Allows independent resetting of INWARD (morning pickup) or OUTWARD (evening drop) routes without wiping the counter direction.",
        note: "Ensures operational flexibility across independent daily shifts.",
        topAccent: COLORS.accentIndigo
    })}

    <!-- Lifecycle Sequence Arrows: Row 3 -->
    <path d="M 530 1375 L 555 1375" fill="none" stroke="${COLORS.accentAmber}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <path d="M 1025 1375 L 1050 1375" fill="none" stroke="${COLORS.accentPurple}" stroke-width="2.2" marker-end="url(#arrow-purple)"/>

    <!-- SECTION 5: PERSISTENCE & CACHE LAYER (MONGODB ATLAS) -->
    ${renderPanel({
        x: 1570, y: 915, w: 990, h: 565,
        num: "05",
        title: "PERSISTENCE & CACHE LAYER (MONGODB ATLAS)",
        subtitle: "Document collections, TTL caching, operational event stores, and telemetry models"
    })}

    <!-- 8 MongoDB Cards in 2 columns x 4 rows -->
    ${renderWhiteCard({
        x: 1595, y: 970, w: 460, h: 110,
        title: "Users Collection (User.js)",
        badge: "CORE COMMUTER & AUTH REPOSITORY",
        bullet1: "Auth credentials, role ('admin' / 'student')",
        bullet2: "travelStatus ('Coming', 'Not Coming', 'Pending')",
        bullet3: "assignedBus, stopName, and E.164 phone number",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2075, y: 970, w: 460, h: 110,
        title: "Vehicles Collection (Vehicle.js)",
        badge: "INSTITUTIONAL FLEET INVENTORY",
        bullet1: "Bus registration number, seating capacity (Cap_v)",
        bullet2: "Vehicle availability & maintenance flags",
        bullet3: "Assigned driver details & operational status",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 1595, y: 1095, w: 460, h: 110,
        title: "Routes & Stops (Route.js | Stop.js)",
        badge: "GIS WAYPOINTS & PATH GEOMETRY",
        bullet1: "Stop names, WGS-84 coordinates (lat/lon)",
        bullet2: "Ordered stop sequences & turn-by-turn polylines",
        bullet3: "Direction flag (INWARD pickup / OUTWARD drop)",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 2075, y: 1095, w: 460, h: 110,
        title: "Schedules Collection (Schedule.js)",
        badge: "TIMETABLE & SHIFT DEFINITIONS",
        bullet1: "Morning pickup shifts & evening return departure times",
        bullet2: "Operational time windows & shift configurations",
        bullet3: "Active timetable flags & academic calendar links",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentEmerald
    })}

    ${renderWhiteCard({
        x: 1595, y: 1220, w: 460, h: 110,
        title: "AI Plans Collection (AiPlan.js)",
        badge: "ai_selected_plans (AUTHORITATIVE)",
        bullet1: "Plan ID, version number, direction (INWARD/OUTWARD)",
        bullet2: "Status lifecycle: 'draft' -> 'approved' -> 'active'",
        bullet3: "Assigned vehicles, passenger manifests & road polylines",
        iconSvg: ICONS.database,
        topAccent: COLORS.pillBlue
    })}

    ${renderWhiteCard({
        x: 2075, y: 1220, w: 460, h: 110,
        title: "Late-Response Events (LateResponseEvent.js)",
        badge: "QUARANTINED LATE RESPONDER QUEUE",
        bullet1: "Deduplicated eventKey: lr_<userId>_<dir>_<time>",
        bullet2: "Student ID, plan approval ID, response timestamp",
        bullet3: "Status: 'PENDING' -> 'RESOLVED' / 'REJECTED'",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentRose,
        badgeColor: COLORS.accentRose
    })}

    ${renderWhiteCard({
        x: 1595, y: 1345, w: 460, h: 110,
        title: "Road Matrix Cache (RoadMatrixCache.js)",
        badge: "TWO-TIER HIGH-SPEED OSRM CACHE",
        bullet1: "Stores road distances & durations between coordinate pairs",
        bullet2: "Automatic TTL expiration (14 days) eliminates re-queries",
        bullet3: "In-memory LRU map handles hot repeat queries",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentAmber
    })}

    ${renderWhiteCard({
        x: 2075, y: 1345, w: 460, h: 110,
        title: "Telemetry & Locations (HistoricalRoute.js)",
        badge: "InwardStartingPlace | mapLocation | RoutePerformance",
        bullet1: "InwardStartingPlace: Starting depot lat/lon per bus",
        bullet2: "mapLocation: OpenStreetMap Nominatim geocode cache",
        bullet3: "RoutePerformance: Planned vs actual mileage & fill ratio",
        iconSvg: ICONS.database,
        topAccent: COLORS.accentPurple
    })}

    <!-- ====================================================================== -->
    <!-- DIRECTIONAL CONNECTOR LINES & LABELS                                   -->
    <!-- ====================================================================== -->
    
    <!-- User to Frontend Connectors -->
    <path d="M 360 245 L 420 245" fill="none" stroke="${COLORS.arrowHttp}" stroke-width="2" marker-end="url(#arrow-blue)"/>
    <text x="390" y="238" font-family="system-ui, sans-serif" font-size="9" font-weight="700" fill="${COLORS.arrowHttp}" text-anchor="middle">HTTPS</text>

    <path d="M 360 398 L 420 398" fill="none" stroke="${COLORS.arrowHttp}" stroke-width="2" marker-end="url(#arrow-blue)"/>
    <text x="390" y="391" font-family="system-ui, sans-serif" font-size="9" font-weight="700" fill="${COLORS.arrowHttp}" text-anchor="middle">HTTPS</text>

    <!-- Frontend to Backend REST Connector -->
    <path d="M 590 470 L 590 550" fill="none" stroke="${COLORS.arrowHttp}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>
    <rect x="525" y="495" width="130" height="18" rx="4" fill="#0c1e3d" stroke="${COLORS.arrowHttp}" stroke-width="1"/>
    <text x="590" y="507" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="${COLORS.arrowHttp}" text-anchor="middle">REST API / JWT</text>

    <!-- Backend to AI Optimization Pipeline Connector -->
    <path d="M 800 795 L 880 795" fill="none" stroke="${COLORS.arrowOpt}" stroke-width="2.2" marker-end="url(#arrow-amber)"/>
    <rect x="815" y="775" width="55" height="18" rx="4" fill="#0c1e3d" stroke="${COLORS.arrowOpt}" stroke-width="1"/>
    <text x="842" y="787" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="${COLORS.arrowOpt}" text-anchor="middle">DEMAND</text>

    <!-- AI Optimization to OSRM / External Services Connector -->
    <path d="M 1975 630 L 2040 630" fill="none" stroke="${COLORS.arrowExt}" stroke-width="2.2" marker-end="url(#arrow-purple)"/>
    <rect x="1985" y="612" width="48" height="18" rx="4" fill="#0c1e3d" stroke="${COLORS.arrowExt}" stroke-width="1"/>
    <text x="2009" y="624" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="${COLORS.arrowExt}" text-anchor="middle">OSRM</text>

    <!-- Backend Services to MongoDB Persistence Connector -->
    <path d="M 697 880 L 697 905 L 1570 905 L 1570 965" fill="none" stroke="${COLORS.arrowDb}" stroke-width="2.2" marker-end="url(#arrow-emerald)"/>
    <rect x="1100" y="896" width="135" height="18" rx="4" fill="#0c1e3d" stroke="${COLORS.arrowDb}" stroke-width="1"/>
    <text x="1167" y="908" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="${COLORS.arrowDb}" text-anchor="middle">MONGOOSE ODM</text>

    <!-- Late Response Flow Connector (Red Arrow) routed along outer margin -->
    <rect x="617" y="882" width="160" height="18" rx="4" fill="#0c1e3d" stroke="${COLORS.arrowLate}" stroke-width="1"/>
    <text x="697" y="894" font-family="system-ui, sans-serif" font-size="9" font-weight="700" fill="${COLORS.arrowLate}" text-anchor="middle">LATE RESPONSE QUARANTINE</text>
    <path d="M 697 900 L 697 905 L 25 905 L 25 1375 L 60 1375" fill="none" stroke="${COLORS.arrowLate}" stroke-width="2" stroke-dasharray="4,3" marker-end="url(#arrow-rose)"/>

    <!-- ====================================================================== -->
    <!-- FOOTER BAR: LEGEND & ACADEMIC CREDENTIALS                              -->
    <!-- ====================================================================== -->
    <g transform="translate(40, 1495)">
        <rect width="2520" height="100" rx="8" fill="#091836" stroke="#1d3b70" stroke-width="1.8"/>

        <!-- Legend Block (Left) -->
        <g transform="translate(24, 20)">
            <text x="0" y="16" font-family="system-ui, sans-serif" font-size="12" font-weight="800" fill="#ffffff">COMMUNICATION LEGEND:</text>
            
            <!-- Item 1: REST -->
            <line x1="170" y1="12" x2="205" y2="12" stroke="${COLORS.arrowHttp}" stroke-width="3" marker-end="url(#arrow-blue)"/>
            <text x="215" y="16" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${COLORS.textCyan}">REST API / HTTPS</text>
            
            <!-- Item 2: Optimization -->
            <line x1="360" y1="12" x2="395" y2="12" stroke="${COLORS.arrowOpt}" stroke-width="3" marker-end="url(#arrow-amber)"/>
            <text x="405" y="16" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#f59e0b">Optimization Pipeline</text>
            
            <!-- Item 3: MongoDB -->
            <line x1="560" y1="12" x2="595" y2="12" stroke="${COLORS.arrowDb}" stroke-width="3" marker-end="url(#arrow-emerald)"/>
            <text x="605" y="16" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#10b981">Database CRUD / TTL</text>

            <!-- Item 4: External Services -->
            <line x1="770" y1="12" x2="805" y2="12" stroke="${COLORS.arrowExt}" stroke-width="3" marker-end="url(#arrow-purple)"/>
            <text x="815" y="16" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#c084fc">External APIs / Baileys</text>

            <!-- Item 5: Late Response -->
            <line x1="990" y1="12" x2="1025" y2="12" stroke="${COLORS.arrowLate}" stroke-width="2.5" stroke-dasharray="4,3" marker-end="url(#arrow-rose)"/>
            <text x="1035" y="16" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#fb7185">Late Quarantine Flow</text>

            <!-- Secondary Subtext -->
            <text x="0" y="44" font-family="system-ui, sans-serif" font-size="10.5" fill="${COLORS.textMuted}">All inter-service calls use typed payloads, structured error boundaries, and explicit transaction locks during live plan activation.</text>
        </g>

        <!-- Project Meta & Verification (Right) -->
        <g transform="translate(1620, 20)">
            <text x="0" y="16" font-family="system-ui, sans-serif" font-size="12" font-weight="800" fill="#ffffff">TECHNICAL INTEGRITY &amp; OPERATIONAL REALITY:</text>
            <text x="0" y="36" font-family="system-ui, sans-serif" font-size="11" fill="#94a3b8">• Runtime Engine: Production runs in <tspan fill="#34d399" font-weight="700">DETERMINISTIC_HEURISTIC_OPTIMIZER</tspan> mode (Clarke-Wright, 2-Opt &amp; Co-occurrence).</text>
            <text x="0" y="52" font-family="system-ui, sans-serif" font-size="11" fill="#94a3b8">• Machine Learning: Standalone Python training pipeline (<tspan fill="#60a5fa">train_model.py</tspan>) exists offline; runtime operates on verified heuristics.</text>
            <text x="0" y="68" font-family="system-ui, sans-serif" font-size="11" fill="#94a3b8">• WhatsApp: Direct embedded <tspan fill="#6ee7b7">Baileys WebSocket</tspan> socket active natively; optional n8n webhook configured for scheduled reminders.</text>
        </g>
    </g>

</svg>`;

    return svg;
}

// Generate the SVG file and save to docs/system-architecture.svg
const svgContent = buildSystemArchitectureSvg();
const docsDir = path.resolve("docs");
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}
const svgPath = path.join(docsDir, "system-architecture.svg");
fs.writeFileSync(svgPath, svgContent, "utf8");
console.log(`Successfully generated SVG architecture diagram at: ${svgPath}`);
console.log(`File size: ${(Buffer.byteLength(svgContent, 'utf8') / 1024).toFixed(2)} KB`);
