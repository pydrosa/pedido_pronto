export function isToday(dateInput: string | Date): boolean {
  const d = new Date(dateInput)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}
