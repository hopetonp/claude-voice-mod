/** Select the latest spoken user request from Composer's chronological Live transcript. */
export function latestLiveUserRequest(lines) {
  const request = lines.findLast(line => line.role === 'user' && line.text.trim() !== '')?.text.trim()
  if (!request) throw new Error('Live delegation has no user request')
  return request
}
