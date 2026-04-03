// Hono context variables (for c.set/c.get type safety)
export type AppEnv = {
  Variables: {
    userId: string
    userEmail: string
    tokenId: string
  }
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface ChatRequest {
  session_id: string
  messages: Message[]
  system?: string
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'none'
}
