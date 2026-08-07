import React from 'react'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import './index.css'

export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      <Layout />
    </div>
  )
}
