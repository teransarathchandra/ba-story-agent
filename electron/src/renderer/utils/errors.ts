import toast from 'react-hot-toast'

export function formatErrorMessage(err: unknown): string {
  if (!err) return 'An unexpected error occurred'
  
  let msg = typeof err === 'string' ? err : (err as any)?.message || String(err)

  // Strip Electron IPC wrapper prefix
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  msg = msg.replace(/^Error:\s*/i, '')

  // Try to parse Zod JSON error output
  try {
    const jsonStart = msg.indexOf('[')
    const jsonEnd = msg.lastIndexOf(']')
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonStr = msg.slice(jsonStart, jsonEnd + 1)
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const messages = parsed.map(item => {
          const field = item.path && item.path.length > 0 ? item.path.join('.') : null
          const itemMsg = item.message || 'Invalid input'
          return field ? `${field}: ${itemMsg}` : itemMsg
        })
        return messages.join('. ')
      }
    }
  } catch {
    // If not JSON, fall through
  }

  // Fallback cleanup
  if (msg.startsWith('SQLite:')) {
    msg = msg.replace(/^SQLite:\s*/i, '')
  }

  return msg.charAt(0).toUpperCase() + msg.slice(1)
}

export function showErrorToast(err: unknown, defaultMsg = 'Operation failed') {
  const formatted = formatErrorMessage(err) || defaultMsg
  toast.error(formatted, {
    style: {
      background: 'var(--bg-elevated, #1e293b)',
      color: 'var(--text-primary, #f8fafc)',
      border: '1px solid var(--border-medium, rgba(255, 255, 255, 0.15))',
      borderRadius: '8px',
      fontSize: '13px',
    },
    iconTheme: {
      primary: '#f43f5e',
      secondary: '#ffffff',
    },
  })
  return formatted
}

export function showSuccessToast(msg: string) {
  toast.success(msg, {
    style: {
      background: 'var(--bg-elevated, #1e293b)',
      color: 'var(--text-primary, #f8fafc)',
      border: '1px solid var(--border-medium, rgba(255, 255, 255, 0.15))',
      borderRadius: '8px',
      fontSize: '13px',
    },
    iconTheme: {
      primary: '#10b981',
      secondary: '#ffffff',
    },
  })
}
