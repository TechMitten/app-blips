import { 
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare, Trophy
} from 'lucide-react';

export const SUGGESTIONS_CODE_CHAR_BUDGET = 12000;

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
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor
};

export const STARTER_PRESETS = [
  {
    title: "Focus Timer",
    prompt: "A cozy focus timer with work/break intervals, gentle chimes, and a streak history.",
    category: "Productivity",
    icon: Timer,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Trip Planner",
    prompt: "A trip planner with a weather forecast, packing checklist, and day-by-day itinerary.",
    category: "Travel",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Bill Splitter",
    prompt: "A bill splitter for group dinners that assigns items to people and calculates tax/tip.",
    category: "Finance",
    icon: Receipt,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Mood & Habit Tracker",
    prompt: "A friendly daily journal combining a mood check-in with quick toggles for habits and streaks.",
    category: "Wellness",
    icon: ListChecks,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Family Chore Board",
    prompt: "A drag-and-drop chore board for a household with columns for 'To Do', 'Doing', and 'Done'.",
    category: "Home",
    icon: Layout,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Subscription Tracker",
    prompt: "A subscription tracker that totals monthly spending and flags upcoming renewals.",
    category: "Finance",
    icon: Wallet,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Game Night Scorekeeper",
    prompt: "A scorekeeper for game night with player rounds, running totals, and a winner celebration.",
    category: "Fun",
    icon: Trophy,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Recipe Box",
    prompt: "A recipe box for saving favorite recipes with an ingredient scaler for serving size.",
    category: "Food",
    icon: Edit2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Workout Log",
    prompt: "A simple workout log for tracking sets, reps, and weight with a progress chart over time.",
    category: "Fitness",
    icon: Calculator,
    color: "text-teal-600 bg-teal-50"
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