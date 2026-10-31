import { readFileSync } from 'node:fs'

const readFixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const fixture = name => JSON.parse(readFixture(name))

export const r1 = fixture('scenario-r1.json')
export const r2 = fixture('scenario-r2.json')
export const clone = value => JSON.parse(JSON.stringify(value))
