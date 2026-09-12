import {
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare, Trophy, Radio, Keyboard, ChefHat, Grid3x3, Brain,
  GraduationCap, Music, Dumbbell
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
    title: "Weather Forecast",
    prompt: "A high-quality weather app built with Material You design and dynamic color palettes. Includes live conditions, 7-day forecast cards, hourly charts, animated weather artwork, and air quality metrics.",
    category: "Weather",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Space Shooter",
    prompt: "A complete, fully functional arcade space shooter with touchscreen virtual controls and keyboard support. Features laser cannons, wave-based alien fleets, shield power-ups, and particle explosion effects.",
    category: "Arcade",
    icon: Rocket,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Internet Radio",
    prompt: "A free live radio streaming app streaming real online radio stations across Lo-Fi, Jazz, Chillwave, and Classical, with an interactive tuner dial, playback controls, and live audio visualizer.",
    category: "Audio",
    icon: Radio,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Typing Test",
    prompt: "A modern typing test app to improve typing skills with a sleek UI, real-time WPM and accuracy metrics, smooth jumping caret, mistyped heatmaps, sound feedback, and practice drill modes.",
    category: "Typing",
    icon: Keyboard,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Recipe Finder",
    prompt: "A polished recipe discovery app with a searchable, filterable card grid, step-by-step cook mode with a built-in timer, adjustable ingredient serving sizes, and a save-to-favorites collection.",
    category: "Cooking",
    icon: ChefHat,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Focus Timer",
    prompt: "A Pomodoro-style focus timer with a smooth animated countdown ring, customizable work/break intervals, an ambient session soundtrack, daily streak tracking, and a running log of completed sessions.",
    category: "Productivity",
    icon: Timer,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Budget Planner",
    prompt: "A personal budget tracker with quick expense entry, category breakdown charts, a monthly spending vs. income summary, savings goal progress bars, and a clean ledger of recent transactions.",
    category: "Finance",
    icon: Wallet,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Sudoku Puzzle",
    prompt: "A fully playable Sudoku game with three difficulty levels, pencil-mark notes, mistake highlighting, a solve timer with best-time tracking, and satisfying animations on row/column/box completion.",
    category: "Puzzle",
    icon: Grid3x3,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Trivia Quiz",
    prompt: "A fast-paced multi-category trivia quiz with a countdown timer per question, animated score reveal, streak bonuses, a results summary screen, and a high-score leaderboard saved between sessions.",
    category: "Quiz",
    icon: Brain,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Flashcard Study",
    prompt: "A spaced-repetition flashcard app with swipeable cards, deck creation and editing, a flip animation, confidence-based review scheduling, and per-deck mastery progress tracking.",
    category: "Education",
    icon: GraduationCap,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Habit Tracker",
    prompt: "A daily habit tracker with a clean weekly grid view, one-tap check-ins, streak counters with milestone celebrations, per-habit color coding, and a monthly completion heatmap.",
    category: "Productivity",
    icon: ListChecks,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Drum Machine",
    prompt: "A playable step-sequencer drum machine with multiple synthesized drum kits, an adjustable BPM, a 16-step pattern grid, pattern save/load slots, and reactive visual pulses on each beat.",
    category: "Audio",
    icon: Music,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Workout Log",
    prompt: "A gym workout logger with exercise search, per-set weight and rep tracking, automatic rest timers between sets, a personal-record tracker, and progress charts across past sessions.",
    category: "Fitness",
    icon: Dumbbell,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Unit Converter",
    prompt: "An elegant unit converter covering length, weight, temperature, volume, and currency with live two-way conversion as you type, a recent-conversions history, and quick-swap unit buttons.",
    category: "Utility",
    icon: Ruler,
    color: "text-blue-600 bg-blue-50"
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