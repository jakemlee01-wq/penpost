import type { ReactNode } from "react";
import type { StoryMeta } from "../lib/schema";

type Scene = NonNullable<StoryMeta["image"]>["scene"];

/**
 * Owned, clearly labeled illustrations for demo stories. Warm, sunny,
 * simple shapes. Real stories should use licensed photos with credits.
 */
export function Illustration({ scene, alt, className, fit = "slice" }: { scene: Scene; alt: string; className?: string; fit?: "slice" | "meet" }) {
  const id = `sky-${scene}`;
  return (
    <svg className={className} style={fit === "meet" ? { overflow: "visible" } : undefined} viewBox="0 0 400 300" preserveAspectRatio={fit === "meet" ? "xMidYMax meet" : "xMidYMid slice"} role="img" aria-label={alt}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="300">
          <stop offset="0" stopColor="#9ED0F5" />
          <stop offset="0.7" stopColor="#D6ECFB" />
          <stop offset="1" stopColor="#FFF1DE" />
        </linearGradient>
      </defs>
      <rect x="-600" y="-900" width="1600" height="1500" fill={`url(#${id})`} />
      <rect x="-600" y="240" width="1600" height="600" fill={GROUND[scene]} />
      <circle cx="318" cy="70" r="34" fill="#FFD983" />
      <circle cx="318" cy="70" r="52" fill="#FFD983" opacity="0.25" />
      <Cloud x={70} y={58} s={1} />
      <Cloud x={210} y={38} s={0.7} />
      {scenes[scene]}
    </svg>
  );
}

// Ground color that continues past the drawing's edges on odd aspect ratios.
const GROUND: Record<Scene, string> = {
  cafe: "#EADBC4",
  office: "#EADBC4",
  van: "#D9D2C5",
  mainstreet: "#EADBC4",
  farm: "#D9AE4E",
  factory: "#E3EDDF",
  industrial: "#9ED0F5",
  road: "#E8C66A",
};

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#FFFFFF" opacity="0.9">
      <ellipse cx="0" cy="0" rx="34" ry="14" />
      <ellipse cx="22" cy="-8" rx="22" ry="14" />
      <ellipse cx="-18" cy="-4" rx="18" ry="11" />
    </g>
  );
}

function Skyline({ y = 190, color = "#B7D3EA" }: { y?: number; color?: string }) {
  return (
    <g fill={color}>
      <rect x="0" y={y - 40} width="40" height="80" />
      <rect x="44" y={y - 70} width="30" height="110" />
      <rect x="78" y={y - 52} width="42" height="92" />
      <rect x="126" y={y - 88} width="26" height="128" />
      <rect x="156" y={y - 46} width="38" height="86" />
      <rect x="252" y={y - 64} width="34" height="104" />
      <rect x="290" y={y - 36} width="44" height="76" />
      <rect x="338" y={y - 80} width="28" height="120" />
      <rect x="370" y={y - 50} width="30" height="90" />
    </g>
  );
}

function Tree({ x, y, s = 1, color = "#7FB77E" }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-3" y="0" width="6" height="22" fill="#9C7A5B" />
      <circle cx="0" cy="-6" r="16" fill={color} />
    </g>
  );
}

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-3" y="18" width="6" height="12" fill="#8A6A4F" />
      <polygon points="0,-30 18,20 -18,20" fill="#4F8F6E" />
    </g>
  );
}

const ground = (color = "#F3E3C7") => <rect x="0" y="240" width="400" height="60" fill={color} />;

const scenes: Record<Scene, ReactNode> = {
  cafe: (
    <g>
      <Skyline y={200} />
      {ground("#EADBC4")}
      <rect x="110" y="120" width="180" height="125" rx="6" fill="#D98B6A" />
      <rect x="110" y="120" width="180" height="16" fill="#C4775A" />
      <path d="M100 150 h200 l-12 26 h-176z" fill="#83BFF0" />
      <path d="M112 176 q11 10 22 0 q11 10 22 0 q11 10 22 0 q11 10 22 0 q11 10 22 0 q11 10 22 0 q11 10 22 0 q11 10 22 0" fill="#83BFF0" />
      <rect x="128" y="188" width="70" height="50" rx="4" fill="#FFF6E5" />
      <rect x="214" y="188" width="56" height="57" rx="4" fill="#7A4E3A" />
      <circle cx="262" cy="218" r="3" fill="#FFD983" />
      <circle cx="150" cy="210" r="8" fill="#C4775A" opacity="0.7" />
      <circle cx="176" cy="212" r="6" fill="#C4775A" opacity="0.5" />
      <Tree x={60} y={220} s={1.2} />
      <Tree x={340} y={222} s={1.1} color="#8CC48A" />
    </g>
  ),
  office: (
    <g>
      {ground("#EADBC4")}
      <rect x="-600" y="40" width="1600" height="200" fill="#FFF8EE" />
      <g fill="#CFE6F8">
        <rect x="24" y="60" width="104" height="130" rx="6" />
        <rect x="148" y="60" width="104" height="130" rx="6" />
        <rect x="272" y="60" width="104" height="130" rx="6" />
      </g>
      <g fill="#A9CBE8">
        <rect x="34" y="120" width="20" height="70" />
        <rect x="60" y="96" width="24" height="94" />
        <rect x="160" y="110" width="30" height="80" />
        <rect x="196" y="84" width="22" height="106" />
        <rect x="286" y="104" width="26" height="86" />
        <rect x="320" y="124" width="40" height="66" />
      </g>
      <rect x="40" y="206" width="320" height="10" rx="5" fill="#C9A27E" />
      <rect x="80" y="178" width="60" height="28" rx="4" fill="#4F6378" />
      <rect x="250" y="178" width="60" height="28" rx="4" fill="#4F6378" />
      <g transform="translate(360 200)">
        <rect x="-12" y="10" width="24" height="30" rx="4" fill="#E2A27C" />
        <circle cx="-6" cy="0" r="12" fill="#7FB77E" />
        <circle cx="8" cy="-4" r="12" fill="#8CC48A" />
      </g>
    </g>
  ),
  van: (
    <g>
      <g fill="#F2D9BD">
        <polygon points="20,190 60,150 100,190" />
        <rect x="28" y="190" width="64" height="50" />
        <polygon points="290,190 335,145 380,190" />
        <rect x="298" y="190" width="74" height="50" />
      </g>
      <polygon points="110,190 160,140 210,190" fill="#E7B99A" />
      <rect x="118" y="190" width="84" height="50" fill="#F5CFAE" />
      {ground("#D9D2C5")}
      <rect x="0" y="252" width="400" height="6" fill="#FFFFFF" opacity="0.6" />
      <g transform="translate(200 196)">
        <rect x="0" y="0" width="140" height="52" rx="10" fill="#FFFFFF" />
        <path d="M100 0 h20 q20 0 20 20 v32 h-40z" fill="#F4F7FA" />
        <rect x="108" y="8" width="24" height="18" rx="4" fill="#9ED0F5" />
        <rect x="10" y="18" width="80" height="12" rx="6" fill="#83BFF0" />
        <circle cx="30" cy="54" r="12" fill="#3D4A58" />
        <circle cx="112" cy="54" r="12" fill="#3D4A58" />
        <circle cx="30" cy="54" r="5" fill="#C9D3DD" />
        <circle cx="112" cy="54" r="5" fill="#C9D3DD" />
      </g>
      <Tree x={70} y={222} s={1.1} />
    </g>
  ),
  mainstreet: (
    <g>
      <g transform="translate(300 90)">
        <rect x="0" y="40" width="34" height="110" fill="#E9DCC6" />
        <rect x="34" y="20" width="22" height="130" fill="#DCCBAF" />
        <polygon points="0,40 17,26 34,40" fill="#DCCBAF" />
      </g>
      {ground("#EADBC4")}
      <rect x="20" y="140" width="96" height="104" fill="#D7A27F" />
      <rect x="20" y="132" width="96" height="14" fill="#C38D6A" />
      <rect x="120" y="120" width="120" height="124" fill="#C98266" />
      <rect x="120" y="112" width="120" height="14" fill="#B4705A" />
      <rect x="136" y="134" width="88" height="18" rx="3" fill="#FFF6E5" />
      <rect x="148" y="140" width="64" height="6" rx="3" fill="#28689D" />
      <rect x="134" y="168" width="44" height="40" rx="3" fill="#CFE6F8" />
      <rect x="190" y="168" width="36" height="76" rx="3" fill="#7A4E3A" />
      <rect x="34" y="166" width="30" height="32" rx="3" fill="#CFE6F8" />
      <rect x="74" y="190" width="28" height="54" rx="3" fill="#7A4E3A" />
      <rect x="244" y="152" width="50" height="92" fill="#E3B48F" />
      <rect x="254" y="170" width="30" height="30" rx="3" fill="#CFE6F8" />
      <Tree x={360} y={222} s={1.2} />
    </g>
  ),
  farm: (
    <g>
      <path d="M-600 210 L0 210 Q100 180 200 205 T400 200 H1000 V300 H-600z" fill="#E8C66A" />
      <path d="M-600 240 L0 240 Q120 220 240 238 T400 236 H1000 V300 H-600z" fill="#D9AE4E" />
      <g stroke="#C79A3E" strokeWidth="2" opacity="0.6">
        <path d="M0 262 Q200 248 400 262" fill="none" />
        <path d="M0 280 Q200 266 400 280" fill="none" />
      </g>
      <g>
        <rect x="200" y="110" width="44" height="100" fill="#D5DDE5" />
        <path d="M200 110 q22 -26 44 0z" fill="#C2CDD8" />
        <rect x="250" y="94" width="52" height="116" fill="#E1E7ED" />
        <path d="M250 94 q26 -30 52 0z" fill="#CBD5DF" />
        <rect x="308" y="124" width="38" height="86" fill="#D5DDE5" />
        <path d="M308 124 q19 -22 38 0z" fill="#C2CDD8" />
        <g stroke="#B8C3CE" strokeWidth="2">
          <line x1="200" y1="140" x2="244" y2="140" />
          <line x1="200" y1="170" x2="244" y2="170" />
          <line x1="250" y1="130" x2="302" y2="130" />
          <line x1="250" y1="165" x2="302" y2="165" />
          <line x1="308" y1="160" x2="346" y2="160" />
        </g>
      </g>
      <Tree x={80} y={196} s={1.2} />
      <Tree x={112} y={200} s={0.9} color="#8CC48A" />
    </g>
  ),
  factory: (
    <g>
      {ground("#E3EDDF")}
      <rect x="0" y="236" width="400" height="10" fill="#CBD9C6" />
      <rect x="70" y="130" width="260" height="110" rx="6" fill="#F7F3EC" />
      <rect x="70" y="130" width="260" height="14" rx="6" fill="#83BFF0" />
      <g fill="#CFE6F8">
        <rect x="90" y="160" width="40" height="30" rx="3" />
        <rect x="140" y="160" width="40" height="30" rx="3" />
        <rect x="190" y="160" width="40" height="30" rx="3" />
        <rect x="240" y="160" width="40" height="30" rx="3" />
      </g>
      <rect x="292" y="168" width="28" height="72" rx="3" fill="#B7C7D6" />
      <rect x="110" y="200" width="160" height="40" rx="3" fill="#E9E1D3" />
      <Tree x={40} y={218} s={1.3} />
      <Tree x={366} y={218} s={1.2} color="#8CC48A" />
    </g>
  ),
  industrial: (
    <g>
      <path d="M-600 190 L0 190 L60 150 L120 185 L190 140 L260 180 L330 145 L400 175 H1000 V300 H-600z" fill="#BFD8C4" />
      <rect x="0" y="236" width="400" height="64" fill="#9ED0F5" />
      <rect x="0" y="236" width="400" height="6" fill="#FFFFFF" opacity="0.5" />
      <g>
        <rect x="150" y="150" width="130" height="86" fill="#E9E4DA" />
        <rect x="170" y="110" width="16" height="40" fill="#D5CEC1" />
        <rect x="200" y="96" width="16" height="54" fill="#D5CEC1" />
        <circle cx="208" cy="84" r="10" fill="#FFFFFF" opacity="0.8" />
        <circle cx="220" cy="72" r="8" fill="#FFFFFF" opacity="0.6" />
        <rect x="236" y="170" width="30" height="20" rx="3" fill="#83BFF0" />
        <rect x="164" y="170" width="56" height="20" rx="3" fill="#CFE6F8" />
      </g>
      <Pine x={40} y={200} s={1.1} />
      <Pine x={80} y={206} s={0.9} />
      <Pine x={320} y={202} s={1.2} />
      <Pine x={360} y={208} s={0.9} />
    </g>
  ),
  road: (
    <g>
      <path d="M-600 200 L0 200 Q100 175 200 195 T400 190 H1000 V300 H-600z" fill="#B9D88F" />
      <path d="M-600 225 L0 225 Q120 205 240 222 T400 218 H1000 V300 H-600z" fill="#E8C66A" />
      <polygon points="180,300 220,300 208,196 196,196" fill="#8E97A1" />
      <polygon points="199,300 201,300 201,196 199,196" fill="#FFFFFF" opacity="0.7" />
      <g transform="translate(170 228)">
        <rect x="0" y="0" width="60" height="40" rx="5" fill="#FFFFFF" />
        <rect x="6" y="6" width="48" height="10" rx="5" fill="#83BFF0" />
        <rect x="14" y="26" width="32" height="10" rx="3" fill="#CFE6F8" />
        <circle cx="12" cy="42" r="6" fill="#3D4A58" />
        <circle cx="48" cy="42" r="6" fill="#3D4A58" />
      </g>
      <Tree x={60} y={194} s={1} />
      <Tree x={340} y={188} s={1.1} color="#8CC48A" />
    </g>
  ),
};
