import { useState } from 'react'

export default function App() {
  const [cups, setCups] = useState(0)
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 id="headline" className="font-display text-5xl font-bold text-espresso">Coffee, roasted slowly</h1>
      <button id="order" className="mt-4 rounded bg-espresso px-4 py-2 text-white" onClick={() => setCups(cups + 1)}>
        Order ({cups})
      </button>
      <article id="story" className="prose mt-8">
        <h2>Our story</h2>
        <p>We have roasted small batches by the harbour since 2009.</p>
      </article>
    </main>
  )
}
