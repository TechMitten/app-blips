import { useState, type ReactNode } from 'react'
import photo from '../assets/photo.png'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-6 shadow">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function Home() {
  const [open, setOpen] = useState(false)
  return (
    <main className="grid gap-6 p-6">
      <h1 className="text-5xl font-bold text-brand" id="headline">We design calm brands</h1>
      <img src={photo} alt="" id="photo" className="size-10" />
      <Card title="Selected work">
        <button id="toggle" className="mt-2 rounded bg-brand px-3 py-1 text-white" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
        {open && <p id="details">Nordic coffee, Fjord Bank, Pine Studio.</p>}
      </Card>
    </main>
  )
}
