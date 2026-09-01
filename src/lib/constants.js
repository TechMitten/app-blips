import { 
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare
} from 'lucide-react';

export const SUGGESTIONS_CODE_CHAR_BUDGET = 12000;

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
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor
};

export const STARTER_PRESETS = [
  {
    title: "Study Session Manager",
    prompt: "A focus timer with work/break intervals and a session history.",
    category: "Productivity",
    icon: Timer,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Travel Dashboard",
    prompt: "A travel dashboard showing weather forecasts and a packing checklist.",
    category: "Travel",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Group Bill Splitter",
    prompt: "A dynamic bill splitter that assigns items and calculates tax/tip.",
    category: "Finance",
    icon: Receipt,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Mood & Habit Journal",
    prompt: "A daily journal combining a mood selector with quick toggles for habits.",
    category: "Wellness",
    icon: ListChecks,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Kanban Board",
    prompt: "A task board with columns for 'To Do', 'In Progress', and 'Done'.",
    category: "Project",
    icon: Layout,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Subscription Manager",
    prompt: "A subscription tracker that estimates monthly costs and categorizes spending.",
    category: "Finance",
    icon: Wallet,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Secure Vault UI",
    prompt: "A vault interface with a password generator and credential cards.",
    category: "Security",
    icon: KeyRound,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Markdown Editor",
    prompt: "A dual-pane markdown editor with a live preview and word count.",
    category: "Utility",
    icon: Edit2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Recipe Scaler",
    prompt: "A recipe ingredient scaler that adjusts measurements by serving size.",
    category: "Tools",
    icon: Calculator,
    color: "text-teal-600 bg-teal-50"
  }
];

export const DEFAULT_MARQUEE_MESSAGE = 'Initializing generation... Preparing code workspace... Analyzing requirements... Writing components...';
export const MARQUEE_SEPARATOR = '  //  ';
export const MARQUEE_MIN_LOOP_LENGTH = 220;
export const MARQUEE_MAX_BUFFER_LENGTH = 4000;
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