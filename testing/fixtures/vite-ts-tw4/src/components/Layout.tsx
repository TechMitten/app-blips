import { NavLink, Outlet } from 'react-router'
import { Sparkles } from 'lucide-react'
import styles from './Layout.module.css'

export default function Layout() {
  return (
    <div className="min-h-screen bg-canvas font-display">
      <header className={`flex items-center gap-6 p-6 ${styles.header}`}>
        <Sparkles className="size-6 text-brand" id="mark" />
        <NavLink to="/" id="nav-home">Work</NavLink>
        <NavLink to="/contact" id="nav-contact">Contact</NavLink>
        <a href="/contact" id="plain-contact">Plain link</a>
      </header>
      <Outlet />
    </div>
  )
}
