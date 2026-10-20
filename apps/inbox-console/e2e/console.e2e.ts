// Drives the console in Chrome against a running playground seeded with `node ace inbox:seed`,
// through a Vite server that proxies to it:
//
//   CONSOLE_URL=http://localhost:5173 pnpm --filter inbox-console e2e
//
// SCREENSHOTS sets where the screenshots go, tmp/console-e2e by default.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const base = process.env.CONSOLE_URL ?? 'http://localhost:5173'
const shots = process.env.SCREENSHOTS ?? 'tmp/console-e2e'
const run = Date.now()
const zoe = `Zoe ${run}`
const PASSWORD = 'inbox-password'

await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const errors: Error[] = []
let shot = 0

async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })

  page.on('pageerror', error => errors.push(error))

  return page
}

function snap(page: Page, name: string) {
  return page.screenshot({ path: join(shots, `${String(++shot).padStart(2, '0')}-${name}.png`) })
}

async function until<T>(check: () => Promise<T>, what: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let last: T | Error | undefined

  while (Date.now() < deadline) {
    try {
      last = await check()

      if (last) return last
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }

    await new Promise(resolve => setTimeout(resolve, 150))
  }

  throw new Error(`timed out waiting for ${what} (last: ${String(last)})`)
}

async function signIn(page: Page, name: string) {
  await page.goto(base)
  await page.getByRole('button', { name, exact: true }).click()
  await snap(page, `login-${name}`)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByTestId('acting-as-name').waitFor()
}

const rows = (page: Page) => page.getByTestId('ticket-row')
const sidebar = (page: Page) => page.getByTestId('sidebar')

async function sawToast(page: Page, text: string) {
  await until(
    async () =>
      (await page.getByTestId('toast').allInnerTexts()).some(shown => shown.includes(text)),
    `the toast "${text}"`,
  )
}

async function navCount(page: Page, testId: string) {
  return Number(await page.getByTestId(testId).getByTestId('count').innerText())
}

async function listTotal(page: Page) {
  const header = await page.getByTestId('list-title').locator('..').innerText()

  return Number(/(\d+)\s*$/.exec(header)?.[1])
}

async function pick(page: Page, menu: string, option: string) {
  await page.getByTestId(menu).click()
  await page.getByRole('option', { name: option }).first().click()
}

const ana = await open()

try {
  await signIn(ana, 'ana')
  assert.equal(await ana.getByTestId('acting-as-name').innerText(), 'Ana Souza')
  await rows(ana).first().waitFor()
  await snap(ana, 'mine')

  for (const view of ['mine', 'unassigned', 'bot', 'open', 'closed']) {
    await ana.getByTestId(`view-${view}`).click()
    await until(
      async () => (await listTotal(ana)) === (await navCount(ana, `view-${view}`)),
      `the ${view} list to match its count`,
    )
  }

  await snap(ana, 'resolved-view')

  await ana.getByTestId('simulate').click()
  await snap(ana, 'simulate-dialog')

  const form = ana.getByTestId('simulate-form')

  await form.getByRole('combobox').selectOption({ label: 'WhatsApp (fila Support)' })
  await form.getByLabel('Nome').fill(zoe)
  await form.getByLabel('Mensagem').fill('Meu pedido chegou quebrado')
  await form.getByRole('button', { name: 'Enviar como cliente' }).click()
  await sawToast(ana, 'Mensagem recebida em WhatsApp.')

  await ana.getByTestId('view-unassigned').click()
  await until(
    async () => (await rows(ana).first().innerText()).includes(zoe),
    'Zoe in Não atribuídas',
  )
  await snap(ana, 'simulated-in-unassigned')

  await ana.getByTestId('search').fill(`zoe ${run}`)
  await until(async () => (await rows(ana).count()) === 1, 'the search to leave one row')
  assert.match(await rows(ana).first().innerText(), new RegExp(zoe))
  await snap(ana, 'search')

  await rows(ana).first().click()
  await ana.getByTestId('thread-title').filter({ hasText: zoe }).waitFor()

  const ticketId = Number(/conversas\/(\d+)/.exec(ana.url())?.[1])

  assert.ok(ticketId > 0, 'the URL names the open conversation')
  assert.equal(
    await ana.getByTestId('composer').getAttribute('placeholder'),
    'Responder assume a conversa',
  )
  assert.equal(await ana.getByTestId('primary-action').innerText(), 'Assumir conversa')
  await snap(ana, 'queued-thread')

  // Bruno opens the queued conversation too. His copy stays as it was while Ana assumes, so his
  // click reaches the inbox and comes back refused.
  const bruno = await open()

  await signIn(bruno, 'bruno')

  const detail = bruno.waitForResponse(
    response =>
      response.url().endsWith(`/inbox/tickets/${ticketId}`) &&
      response.request().method() === 'GET',
  )

  await bruno.goto(`${base}/#/conversas/${ticketId}`)
  await bruno.getByTestId('primary-action').filter({ hasText: 'Assumir conversa' }).waitFor()

  let frozen: string | null = await (await detail).text()

  await bruno.route(`**/inbox/tickets/${ticketId}`, route =>
    frozen !== null && route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: frozen })
      : route.continue(),
  )

  await ana.getByTestId('primary-action').click()
  await sawToast(ana, 'Conversa assumida')
  await until(
    async () => (await ana.getByTestId('primary-action').innerText()) === 'Resolver',
    'Resolver once Ana holds it',
  )

  frozen = null
  await bruno.getByTestId('primary-action').click()
  await sawToast(bruno, 'Esta conversa já está com Ana Souza.')
  await bruno.getByTestId('banner').filter({ hasText: 'Em atendimento por Ana Souza' }).waitFor()
  assert.equal(await bruno.getByTestId('primary-action').count(), 0, 'nothing left that would fail')
  assert.match(await bruno.getByTestId('composer-disabled').innerText(), /Ana Souza está atendendo/)
  await snap(bruno, 'held-by-other')
  await bruno.close()

  await ana.getByTestId('composer').fill('Sinto muito! Vou abrir a troca agora.')
  await ana.getByTestId('composer').press('Enter')
  await until(async () => {
    const bubble = ana.getByTestId('bubble').filter({ hasText: 'Vou abrir a troca agora.' }).last()

    return (
      (await bubble.count()) > 0 &&
      (await bubble.getByTestId('delivery').getAttribute('data-status'))
    )
  }, 'the reply bubble with its status')
  assert.equal(await ana.getByTestId('composer').inputValue(), '', 'the composer is cleared')
  await snap(ana, 'replied')

  await pick(ana, 'assign', 'Elisa Prado')
  await sawToast(ana, 'Conversa atribuída a Elisa Prado.')
  await ana.getByTestId('banner').filter({ hasText: 'Em atendimento por Elisa Prado' }).waitFor()
  assert.match(await sidebar(ana).innerText(), /Com\s+Elisa Prado/)
  await snap(ana, 'assigned')

  await pick(ana, 'transfer', 'Billing')
  await sawToast(ana, 'Conversa transferida para Billing.')
  await until(
    async () => /Fila\s+Billing/.test(await sidebar(ana).innerText()),
    'the Billing queue',
  )
  assert.match(await sidebar(ana).innerText(), /Situação\s+Na fila/)
  await snap(ana, 'transferred')

  await ana.getByTestId('primary-action').filter({ hasText: 'Assumir conversa' }).click()
  await ana.getByTestId('primary-action').filter({ hasText: 'Resolver' }).click()
  await snap(ana, 'resolve-dialog')
  await ana.getByTestId('confirm-resolve').click()
  await sawToast(ana, 'Conversa resolvida.')
  await ana
    .getByTestId('composer-disabled')
    .filter({ hasText: 'Esta conversa foi resolvida.' })
    .waitFor()
  await ana.getByTestId('search').fill('')
  await ana.getByTestId('view-closed').click()
  await until(async () => (await rows(ana).first().innerText()).includes(zoe), 'Zoe in Resolvidas')
  await snap(ana, 'resolved')

  await ana.getByTestId('settings').click()
  await ana.getByRole('button', { name: 'Novo agente' }).click()

  const agent = ana.getByTestId('new-agent')

  await agent.getByLabel('Nome').fill(zoe)
  await agent.getByLabel('E-mail').fill(`zoe-${run}@inbox.test`)
  await agent.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await agent.getByTestId('queue-toggle-Support').click()
  await agent.getByTestId('queue-toggle-Sales').click()
  await snap(ana, 'new-agent')
  await agent.getByRole('button', { name: 'Criar agente' }).click()
  await sawToast(ana, `${zoe} já pode entrar no console.`)

  const created = ana.getByTestId('agent-row').filter({ hasText: `zoe-${run}@inbox.test` })

  await created.waitFor()
  assert.deepEqual(await created.getByRole('switch', { checked: true }).allInnerTexts(), [
    'Support',
    'Sales',
  ])
  await snap(ana, 'agent-created')

  assert.deepEqual(errors, [], 'no uncaught errors in the page')
  console.log(`ok: ${shot} screenshots in ${shots}`)
} finally {
  await browser.close()
}
