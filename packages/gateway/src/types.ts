export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  session_id: string
  messages: Message[]
  system?: string
}
