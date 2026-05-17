import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import OpenAI from 'openai'
import type { Connect, Plugin } from 'vite'

function readRequestBody(req: Connect.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function parseAgentOutput(output: string) {
  try {
    return JSON.parse(output) as {
      reply?: string
      action?: unknown
    }
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { reply: output }

    try {
      return JSON.parse(jsonMatch[0]) as {
        reply?: string
        action?: unknown
      }
    } catch {
      return { reply: output }
    }
  }
}

function aiAgentPlugin(): Plugin {
  return {
    name: 'ert-ai-agent-api',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY is missing from .env' }))
          return
        }

        try {
          const rawBody = await readRequestBody(req)
          const body = JSON.parse(rawBody || '{}') as {
            message?: string
            history?: { role: 'user' | 'assistant'; content: string }[]
            context?: unknown
          }

          const message = body.message?.trim()
          if (!message) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Message is required' }))
            return
          }

          const client = new OpenAI({ apiKey })
          const history = (body.history ?? [])
            .slice(-8)
            .map((item) => `${item.role === 'user' ? 'משתמש' : 'סוכן'}: ${item.content}`)
            .join('\n')

          const response = await client.responses.create({
            model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
            instructions:
              'אתה סוכן AI בתוך מערכת ERT לניהול דירת שותפים. ענה בעברית קצרה וברורה. ' +
              'השתמש רק בהקשר שהאתר שולח לך. אל תטען שביצעת פעולה בפועל. ' +
              'כאשר המשתמש מבקש שינוי באתר, החזר פעולה מובנית לאישור המשתמש. ' +
              'החזר תמיד JSON תקין בלבד בפורמט: {"reply":"טקסט למשתמש","action":null או אובייקט}. ' +
              'פעולות מותרות: ' +
              'create_task {title, taskType, targetItemName, description, assigneeName, dueDate}; ' +
              'update_task_due_date {taskId, taskTitle, dueDate}; ' +
              'update_task_status {taskId, taskTitle, status}; ' +
              'create_expense {description, amount, category, date, paidByName}; ' +
              'create_shopping_item {itemName, quantity, category}; ' +
              'create_ticket {title, description, category}. ' +
              'status מותר: open, in_progress, done, cancelled. ' +
              'taskType מותר: cleaning, maintenance, shopping, inspection, other. ' +
              'category לפנייה מותר: issue, request, finance, other. ' +
              'assigneeName אופציונלי; אם לא צוין אחראי, האתר ישתמש במשתמש הנוכחי. ' +
              'אם המשתמש אומר מחר/שבוע הבא, חשב dueDate לפי context.today והחזר YYYY-MM-DD. ' +
              'אם חסר פרט שבאמת אי אפשר להשלים, שאל שאלה ואל תחזיר action.',
            input: [
              `הקשר מהאתר:\n${JSON.stringify(body.context ?? {}, null, 2)}`,
              history ? `שיחה קודמת:\n${history}` : '',
              `משתמש: ${message}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          })
          const agentOutput = parseAgentOutput(response.output_text)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              reply: agentOutput.reply || response.output_text,
              action: agentOutput.action ?? null,
            }),
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'AI request failed'
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.OPENAI_API_KEY =
    process.env.OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()
  const configuredModel = process.env.OPENAI_MODEL?.trim() || env.OPENAI_MODEL?.trim()
  if (configuredModel) process.env.OPENAI_MODEL = configuredModel

  return {
    plugins: [react(), aiAgentPlugin()],
  }
})
