import type Channel from '#models/inbox/channel'
import type Queue from '#models/inbox/queue'
import type Ticket from '#models/inbox/ticket'
import { writeIn } from '#services/fake_inbound'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import type { Attendant } from '@enzopita/adonisjs-inbox/types'
import { randomUUID } from 'node:crypto'

/**
 * Every seeded agent logs in with it.
 */
export const SEED_PASSWORD = 'inbox-password'

const QUEUES = ['Support', 'Billing', 'Sales'] as const

type QueueName = (typeof QUEUES)[number]

const AGENTS = [
  { fullName: 'Ana Souza', email: 'ana@inbox.test', queues: ['Support', 'Billing'] },
  { fullName: 'Bruno Lima', email: 'bruno@inbox.test', queues: ['Support'] },
  { fullName: 'Carla Dias', email: 'carla@inbox.test', queues: ['Billing'] },
  { fullName: 'Diego Rocha', email: 'diego@inbox.test', queues: ['Sales'] },
  { fullName: 'Elisa Prado', email: 'elisa@inbox.test', queues: ['Sales', 'Support'] },
  { fullName: 'Felipe Melo', email: 'felipe@inbox.test', queues: ['Billing', 'Sales'] },
] as const satisfies ReadonlyArray<{ fullName: string; email: string; queues: QueueName[] }>

type AgentEmail = (typeof AGENTS)[number]['email']

const CHANNELS = [
  { name: 'WhatsApp', queue: 'Support' },
  { name: 'Site chat', queue: 'Sales' },
] as const

type ChannelName = (typeof CHANNELS)[number]['name']

/**
 * Where the seed leaves a conversation's ticket once its messages are in. `by` is the agent who
 * takes it, and `queue` a queue it is transferred to first.
 */
type Outcome =
  | { status: 'queued' }
  | { status: 'held'; by: AgentEmail; reply?: string; queue?: QueueName }
  | { status: 'closed'; by: AgentEmail; reply: string }
  | { status: 'bot' }

interface Script {
  name: string
  address: string
  channel: ChannelName
  messages: string[]
  outcome: Outcome
}

const SCRIPTS: Script[] = [
  {
    name: 'Mariana Alves',
    address: '+5511990000001',
    channel: 'WhatsApp',
    messages: ['Oi, meu pedido não chegou ainda.'],
    outcome: { status: 'queued' },
  },
  {
    name: 'Rafael Costa',
    address: '+5511990000002',
    channel: 'WhatsApp',
    messages: ['Preciso da segunda via do boleto.', 'É o de outubro.'],
    outcome: { status: 'held', by: 'carla@inbox.test', queue: 'Billing' },
  },
  {
    name: 'Juliana Ribeiro',
    address: '+5511990000003',
    channel: 'WhatsApp',
    messages: ['O app trava quando abro o carrinho.'],
    outcome: { status: 'held', by: 'bruno@inbox.test', reply: 'Qual versão do app você usa?' },
  },
  {
    name: 'Pedro Martins',
    address: '+5511990000004',
    channel: 'Site chat',
    messages: ['Vocês têm plano para empresas?'],
    outcome: { status: 'held', by: 'diego@inbox.test', reply: 'Temos sim! Quantos usuários?' },
  },
  {
    name: 'Camila Ferreira',
    address: '+5511990000005',
    channel: 'Site chat',
    messages: ['Quero cancelar minha assinatura.'],
    outcome: { status: 'closed', by: 'elisa@inbox.test', reply: 'Cancelado. Até a próxima!' },
  },
  {
    name: 'Lucas Gomes',
    address: '+5511990000006',
    channel: 'WhatsApp',
    messages: ['Bom dia', 'Alguém aí?'],
    outcome: { status: 'queued' },
  },
  {
    name: 'Beatriz Santos',
    address: '+5511990000007',
    channel: 'WhatsApp',
    messages: ['Fui cobrada duas vezes.'],
    outcome: { status: 'held', by: 'ana@inbox.test', queue: 'Billing', reply: 'Vou verificar.' },
  },
  {
    name: 'Thiago Oliveira',
    address: '+5511990000008',
    channel: 'Site chat',
    messages: ['Qual o prazo de entrega para Recife?'],
    outcome: { status: 'closed', by: 'diego@inbox.test', reply: 'De 3 a 5 dias úteis.' },
  },
  {
    name: 'Larissa Pereira',
    address: '+5511990000009',
    channel: 'WhatsApp',
    messages: ['Como troco minha senha?'],
    outcome: { status: 'bot' },
  },
  {
    name: 'Gabriel Carvalho',
    address: '+5511990000010',
    channel: 'Site chat',
    messages: ['Tem desconto para pagamento anual?'],
    outcome: { status: 'queued' },
  },
  {
    name: 'Fernanda Araújo',
    address: '+5511990000011',
    channel: 'WhatsApp',
    messages: ['Recebi o produto errado.'],
    outcome: { status: 'held', by: 'elisa@inbox.test' },
  },
  {
    name: 'Mateus Barbosa',
    address: '+5511990000012',
    channel: 'WhatsApp',
    messages: ['A nota fiscal veio com o CNPJ errado.'],
    outcome: { status: 'closed', by: 'ana@inbox.test', reply: 'Corrigida e reenviada.' },
  },
  {
    name: 'Isabela Teixeira',
    address: '+5511990000013',
    channel: 'Site chat',
    messages: ['Vocês integram com o meu ERP?'],
    outcome: { status: 'held', by: 'felipe@inbox.test', reply: 'Qual ERP você usa?' },
  },
  {
    name: 'Rodrigo Moreira',
    address: '+5511990000014',
    channel: 'WhatsApp',
    messages: ['Meu cupom não funciona.'],
    outcome: { status: 'queued' },
  },
  {
    name: 'Patrícia Cardoso',
    address: '+5511990000015',
    channel: 'WhatsApp',
    messages: ['Quero mudar o endereço de entrega.'],
    outcome: { status: 'bot' },
  },
  {
    name: 'Vinícius Rocha',
    address: '+5511990000016',
    channel: 'Site chat',
    messages: ['Posso parcelar em 12x?'],
    outcome: { status: 'held', by: 'diego@inbox.test' },
  },
  {
    name: 'Aline Nunes',
    address: '+5511990000017',
    channel: 'WhatsApp',
    messages: ['Obrigada pelo atendimento de ontem!'],
    outcome: { status: 'closed', by: 'bruno@inbox.test', reply: 'Nós que agradecemos!' },
  },
  {
    name: 'Eduardo Pinto',
    address: '+5511990000018',
    channel: 'WhatsApp',
    messages: ['O estorno ainda não caiu.'],
    outcome: { status: 'queued' },
  },
  {
    name: 'Sofia Mendes',
    address: '+5511990000019',
    channel: 'Site chat',
    messages: ['Quero falar com um vendedor.'],
    outcome: { status: 'held', by: 'elisa@inbox.test', queue: 'Sales' },
  },
  {
    name: 'Henrique Castro',
    address: '+5511990000020',
    channel: 'WhatsApp',
    messages: ['O site está fora do ar?'],
    outcome: { status: 'queued' },
  },
]

export default class InboxSeed extends BaseCommand {
  static commandName = 'inbox:seed'
  static description =
    'Seed queues, agents, fake channels and conversations for the console. Safe to run again'

  static options: CommandOptions = { startApp: true }

  async run() {
    // Imported once the app booted: the user model, which the attendant model imports, takes the
    // hash service as its module loads.
    const { default: User } = await import('#models/user')
    const { default: Queue } = await import('#models/inbox/queue')
    const { default: Channel } = await import('#models/inbox/channel')
    const { default: Contact } = await import('#models/inbox/contact')
    const { default: Ticket } = await import('#models/inbox/ticket')
    const queues = new Map<QueueName, Queue>()

    for (const name of QUEUES) queues.set(name, await Queue.firstOrCreate({ name }))

    const agents = new Map<AgentEmail, Attendant>()

    for (const { fullName, email, queues: names } of AGENTS) {
      const user = await User.firstOrCreate({ email }, { fullName, password: SEED_PASSWORD })
      const attendant = await inbox.attendants.forUser(user.id)

      for (const name of names) await inbox.queues.addMember(queues.get(name)!.id, attendant)

      agents.set(email, attendant)
    }

    const channels = new Map<ChannelName, Channel>()

    for (const { name, queue } of CHANNELS) {
      const channel = await Channel.firstOrCreate(
        { name, provider: 'fake' },
        {
          defaultQueueId: queues.get(queue)!.id,
          webhookToken: randomUUID(),
          credentials: { secret: randomUUID() },
        },
      )

      channels.set(name, channel)
    }

    const triage = await inbox.attendants.bot('triage')
    let started = 0

    for (const [index, script] of SCRIPTS.entries()) {
      const channel = channels.get(script.channel)!

      // A conversation the seed already started is left as it is, whatever the console did to it.
      if (await Contact.findBy({ channelId: channel.id, address: script.address })) continue

      for (const [position, text] of script.messages.entries()) {
        const receipt = await writeIn(channel, {
          from: script.address,
          name: script.name,
          text,
          externalId: `seed-${index}-${position}`,
        })

        if (receipt !== 'accepted') throw new Error(`the seed's webhook was ${receipt}`)
      }

      const ticket = await Ticket.query()
        .whereNotNull('openConversationId')
        .whereHas('conversation', conversation =>
          conversation
            .where('channelId', channel.id)
            .whereHas('contact', contact => contact.where('address', script.address)),
        )
        .firstOrFail()

      await this.#settle(ticket, script.outcome, { agents, queues, triage }, index)
      started++
    }

    this.logger.info(
      `${queues.size} queues, ${agents.size} agents (password "${SEED_PASSWORD}"), ${channels.size} channels, ${started} new conversations of ${SCRIPTS.length}`,
    )
  }

  async #settle(
    ticket: Ticket,
    outcome: Outcome,
    seeded: {
      agents: Map<AgentEmail, Attendant>
      queues: Map<QueueName, Queue>
      triage: Attendant
    },
    index: number,
  ) {
    if (outcome.status === 'queued') return

    if (outcome.status === 'bot') {
      const [first] = seeded.agents.values()

      return this.#expect(
        await inbox.tickets.apply(ticket.id, { gesture: 'assign', to: seeded.triage.id }, first),
      )
    }

    const agent = seeded.agents.get(outcome.by)!

    if (outcome.status === 'held' && outcome.queue !== undefined) {
      const queueId = seeded.queues.get(outcome.queue)!.id

      this.#expect(
        await inbox.tickets.apply(ticket.id, { gesture: 'transfer', queueId, to: agent.id }, agent),
      )
    } else {
      this.#expect(await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, agent))
    }

    if (outcome.reply !== undefined) {
      this.#expect(
        await inbox.messages.send(ticket.id, { kind: 'text', text: outcome.reply }, agent, {
          clientRef: `seed-${index}-reply`,
        }),
      )
    }

    if (outcome.status === 'closed') {
      this.#expect(
        await inbox.tickets.apply(ticket.id, { gesture: 'close', reason: 'manual' }, agent),
      )
    }
  }

  #expect(result: { outcome: string; reason?: string }) {
    if (result.outcome === 'rejected') throw new Error(`the seed was rejected: ${result.reason}`)
  }
}
