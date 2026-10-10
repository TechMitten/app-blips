import { Link, Route, Routes } from "react-router-dom"
import Home from "@/pages/Home"
import About from "@/pages/About"

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border p-4">
        <img src="/logo.svg" alt="Acme" width={32} height={32} id="logo" />
        <nav className="flex gap-4">
          <Link to="/" id="nav-home">Home</Link>
          <Link to="/about" id="nav-about">About</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </div>
  )
}
