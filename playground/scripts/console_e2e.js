// Drives /console in Chrome against a running playground seeded with `node ace inbox:seed`:
//
//   CONSOLE_URL=http://localhost:3333 node scripts/console_e2e.js
//
// SCREENSHOTS sets where the screenshots go, tmp/console-e2e by default.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium } from 'playwright'

const base = process.env.CONSOLE_URL ?? 'http://localhost:3333'
const shots = process.env.SCREENSHOTS ?? 'tmp/console-e2e'
const run = Date.now()
const zoe = `Zoe ${run}`

await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error))

let shot = 0
const snap = name =>
  page.screenshot({
    path: join(shots, `${String(++shot).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  })

async function until(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      if ((last = await check())) return last
    } catch (error) {
      last = error
    }
    await page.waitForTimeout(150)
  }
  throw new Error(`timed out waiting for ${what} (last: ${last})`)
}

const rows = () => page.locator('[data-testid="ticket-list"] button.ticket')
const rowTexts = () => rows().allInnerTexts()
const detailText = () => page.getByTestId('detail').innerText()
const notice = () => page.getByTestId('detail').getByTestId('notice').innerText()
const error = () => page.getByTestId('detail').getByTestId('error').innerText()

async function chipCount(status) {
  const text = await page.getByTestId(`chip-${status}`).innerText()
  return Number(text.match(/(\d+)\s*$/)[1])
}

async function actAs(name) {
  const value = await page
    .locator('#acting-as option', { hasText: name })
    .first()
    .getAttribute('value')
  await page.getByTestId('acting-as').selectOption(value)
  if (await page.locator('#login').isVisible()) {
    await page.locator('#login-form button[type=submit]').click()
  }
  await until(
    async () =>
      (await page.getByTestId('acting-as').inputValue()) !== '' &&
      !(await page.locator('#login').isVisible()),
    `acting as ${name}`,
  )
  await until(
    async () => (await page.locator('#acting-as option:checked').innerText()).startsWith(name),
    `${name} selected`,
  )
}

try {
  await page.goto(`${base}/console`)
  await page.locator('#login-form button[type=submit]').click()
  await until(async () => (await rows().count()) > 0, 'the ticket list')
  await snap('tickets')

  await page.getByTestId('chip-queued').click()
  await until(async () => {
    const texts = await rowTexts()
    return texts.length > 0 && texts.every(text => text.includes('Queued'))
  }, 'only queued tickets')
  const queued = await chipCount('queued')
  assert.equal(await rows().count(), Math.min(queued, 20), 'the queued chip counts the queued rows')

  await page.getByTestId('chip-in_progress').click()
  const open = queued + (await chipCount('in_progress'))
  await until(
    async () => (await page.locator('#list-total').innerText()) === `${open} matching`,
    'queued and in-progress tickets together',
  )
  assert.ok(
    (await rowTexts()).every(text => !text.includes('Closed')),
    'no closed ticket is listed',
  )
  await page.getByTestId('chip-in_progress').click()
  await until(
    async () => (await page.locator('#list-total').innerText()) === `${queued} matching`,
    'queued only again',
  )

  await page.getByTestId('filter-queue').selectOption({ label: 'Support' })
  await until(
    async () =>
      (await rowTexts()).every(text => text.includes('Support') && text.includes('Queued')),
    'queued Support tickets',
  )
  await snap('filtered-queued-support')

  await page.getByTestId('chip-queued').click()
  await page.getByTestId('filter-queue').selectOption({ label: 'Any queue' })
  await page.getByTestId('filter-search').fill('MARI')
  await until(async () => {
    const texts = await rowTexts()
    return texts.length === 1 && texts[0].includes('Mariana Alves')
  }, 'the search to find Mariana alone')
  assert.deepEqual(
    [await chipCount('queued'), await chipCount('in_progress'), await chipCount('closed')],
    [1, 0, 0],
  )
  await snap('search')

  await page.getByTestId('filter-search').fill('')
  const address = `+5521${String(run).slice(-9)}`
  await page.getByTestId('sim-channel').selectOption({ label: 'WhatsApp (fake)' })
  await page.getByTestId('sim-from').fill(address)
  await page.getByTestId('sim-name').fill(`E2E ${run}`)
  await page.getByTestId('sim-text').fill('Oi, vim pelo teste de ponta a ponta.')
  await page.locator('#simulate button[type=submit]').click()
  await until(
    async () => (await page.getByTestId('detail-contact').innerText()) === `E2E ${run}`,
    'the simulated ticket',
  )
  await until(
    async () =>
      (await rowTexts()).some(text => text.includes(`E2E ${run}`) && text.includes('Queued')),
    'the new ticket in the list',
  )
  assert.match(await detailText(), /Oi, vim pelo teste de ponta a ponta\./)
  assert.match(await detailText(), /Opened in Support \(inbound\)/)
  await snap('simulated-inbound')

  await page.getByTestId('assume').click()
  await until(async () => (await notice()) === 'Assume: changed', 'the assume')
  assert.match(await page.getByTestId('detail-assignee').innerText(), /Ana Souza/)

  const reply = `Olá, vou verificar (${run}).`
  await page.getByTestId('reply').fill(reply)
  await page.getByTestId('send-reply').click()
  const bubble = page.getByTestId('thread').locator('.bubble.outbound', { hasText: reply })
  await until(
    async () => /Ana Souza · sent/.test(await bubble.innerText()),
    'the reply sent by Ana',
  )
  await snap('assumed-and-replied')

  await actAs('Bruno Lima')
  await page.getByTestId('assume').click()
  await until(
    async () => (await error()) === '409 rejected: held_by_other',
    'the held_by_other rejection',
  )
  await snap('rejected-held-by-other')
  await actAs('Ana Souza')

  const email = `zoe-${run}@inbox.test`
  await page.getByRole('button', { name: 'Agents' }).click()
  await page.getByTestId('agent-name').fill(zoe)
  await page.getByTestId('agent-email').fill(email)
  await page.locator('#a-queues label', { hasText: 'Support' }).locator('input').check()
  await page.locator('#agent-form button[type=submit]').click()
  const agentRow = page.locator(`tr[data-email="${email}"]`)
  await until(
    async () => (await agentRow.innerText()).includes('Support'),
    'the new agent in Support',
  )
  const userId = (await agentRow.getAttribute('data-testid')).replace('agent-', '')
  await page.getByTestId(`add-queue-${userId}`).selectOption({ label: 'Billing' })
  await page.getByTestId(`add-member-${userId}`).click()
  await until(async () => (await agentRow.innerText()).includes('Billing'), 'Zoe added to Billing')
  await snap('agent-created')

  await page.getByRole('button', { name: 'Tickets' }).click()
  await page.getByTestId('assign-to').selectOption({ label: zoe })
  await page.getByTestId('assign').click()
  await until(async () => (await notice()) === 'Assign: changed', 'the assign to Zoe')
  assert.match(await page.getByTestId('detail-assignee').innerText(), new RegExp(zoe))

  await page.getByTestId('close').click()
  await until(
    async () => (await error()) === '409 rejected: forbidden',
    "Ana can't close Zoe's ticket",
  )
  await actAs(zoe)
  await page.getByTestId('close-note').fill('resolved in the e2e run')
  await page.getByTestId('close').click()
  await until(async () => (await notice()) === 'Close: changed', 'the close by Zoe')
  assert.match(await page.getByTestId('detail-state').innerText(), /Closed[\s\S]*\(manual\)/)
  assert.match(await detailText(), /Closed \(manual\)[\s\S]*note: resolved in the e2e run/)
  await snap('closed')

  assert.deepEqual(errors, [], 'the page threw no error')
  console.log(`console e2e passed, screenshots in ${shots}`)
} catch (failure) {
  await snap('failure')
  throw failure
} finally {
  await browser.close()
}
