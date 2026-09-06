import { 
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare, Trophy, Radio, Keyboard
} from 'lucide-react';

// Cloudflare Turnstile site key for Supabase auth bot protection. Public by
// design (the matching secret lives in Supabase Auth > Bot and Abuse Protection).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAEj8I1oDBw3Rwb8l';

export const HTML_STREAM_START_RE = /```html|<!DOCTYPE html|<html[\s>]/i;

export const PRESET_COLORS = [
  "text-amber-600 bg-amber-50",
  "text-sky-600 bg-sky-50",
  "text-emerald-600 bg-emerald-50",
  "text-indigo-600 bg-indigo-50",
  "text-violet-600 bg-violet-50",
  "text-rose-600 bg-rose-50",
  "text-blue-600 bg-blue-50",
  "text-teal-600 bg-teal-50"
];

export const AVAILABLE_ICONS = {
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor, Trophy, Radio, Keyboard, Rocket
};

export const STARTER_PRESETS = [
  {
    title: "Nimbus Weather",
    prompt: "A high-quality weather app built with Material You design and dynamic color palettes. Includes live conditions, 7-day forecast cards, hourly charts, animated weather artwork, and air quality metrics.",
    category: "Weather",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Cosmic Strike",
    prompt: "A complete, fully functional arcade space shooter with touchscreen virtual controls and keyboard support. Features laser cannons, wave-based alien fleets, shield power-ups, and particle explosion effects.",
    category: "Arcade",
    icon: Rocket,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "LiveWave Radio",
    prompt: "A free live radio streaming app streaming real online radio stations across Lo-Fi, Jazz, Chillwave, and Classical, with an interactive tuner dial, playback controls, and live audio visualizer.",
    category: "Audio",
    icon: Radio,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "TypePulse Studio",
    prompt: "A modern typing test app to improve typing skills with a sleek UI, real-time WPM and accuracy metrics, smooth jumping caret, mistyped heatmaps, sound feedback, and practice drill modes.",
    category: "Typing",
    icon: Keyboard,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Neon Serpent",
    prompt: "A neon snake arcade game with glowing trails, swipe-friendly touch controls, and a high-score board.",
    category: "Arcade",
    icon: Zap,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Pocket Garden",
    prompt: "A virtual windowsill garden where plants wilt if you skip watering days, with growth stages and a care log.",
    category: "Wellness",
    icon: CloudSun,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Pocket Beats",
    prompt: "A 16-step drum machine with a punchy WebAudio kit, a tempo slider, and a few preset beats to remix.",
    category: "Music",
    icon: Layers,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Chore Quest",
    prompt: "A family chore board where chores are quests worth XP, and players level up from Couch Loafer to Chore Legend.",
    category: "Home",
    icon: ListChecks,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Sub Hunter",
    prompt: "A subscription tracker that totals your monthly drains in one dial and warns you before the next renewal sneaks up.",
    category: "Finance",
    icon: Receipt,
    color: "text-amber-600 bg-amber-50"
  }
];

export const PREVIEW_MODES = {
  mobile: {
    label: 'Mobile',
    width: 399,
    height: 820,
    deviceClass: 'device-smartphone',
    isTouchChrome: true,
    zoomPadding: { h: 32, v: 32 }
  },
  tablet: {
    label: 'Tablet',
    width: 810,
    height: 1080,
    deviceClass: 'device-tablet',
    isTouchChrome: true,
    zoomPadding: { h: 52, v: 44 }
  },
  desktop: {
    label: 'Desktop',
    width: 1468,
    height: 1022,
    deviceClass: 'device-desktop',
    isTouchChrome: false,
    zoomPadding: { h: 72, v: 54 }
  }
};

// Desktop has no orientation concept (it's a browser window, not a rotatable
// device), so only touch-chrome modes (mobile/tablet) swap width/height here.