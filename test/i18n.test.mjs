import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickLang, STRINGS, t, counterText, pointsSeenText } from '../page/i18n.mjs'

test('pickLang', () => {
  assert.equal(pickLang(['fr-FR', 'en']), 'fr')
  assert.equal(pickLang(['de', 'en-GB']), 'en')
  assert.equal(pickLang([]), 'en')
})

test('fr and en have the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.fr).sort(), Object.keys(STRINGS.en).sort())
})

test('page copy', () => {
  assert.equal(t('fr', 'send'), 'Envoyer à Claude')
  assert.equal(t('fr', 'next'), 'Étape suivante')
  assert.equal(t('fr', 'prev'), 'Étape précédente')
  assert.equal(t('fr', 'comment'), 'Commenter')
  assert.equal(t('fr', 'reopen'), 'Revoir quand même')
  assert.equal(t('fr', 'sent'), "Review envoyée. Claude te répond dans Claude Code. S'il lance un nouveau tour, il s'affichera dans cet onglet.")
  assert.equal(t('fr', 'nextStep', { title: 'Créer un client' }), 'Étape suivante : Créer un client')
  assert.equal(t('fr', 'docTitle', { n: 40 }), 'Recette · PR #40')
  assert.equal(t('en', 'docTitle', { n: 40 }), 'Review · PR #40')
  assert.equal(t('fr', 'colon'), ' : ')
  assert.equal(t('en', 'colon'), ': ')
  assert.equal(t('fr', 'openApp'), "Ouvrir l'app à côté")
  assert.equal(counterText('fr', 1, 2), '1 commentaire · 2 points à voir')
  assert.equal(counterText('fr', 0, 1), '0 commentaire · 1 point à voir')
  assert.equal(counterText('fr', 3, 0), '3 commentaires · 0 point à voir')
  assert.equal(counterText('en', 2, 1), '2 comments · 1 point left')
  assert.equal(counterText('en', 1, 0), '1 comment · 0 points left')
  assert.equal(t('fr', 'judge'), 'À juger')
  assert.equal(t('fr', 'stepOf', { n: 2, total: 4 }), 'Étape 2/4')
  assert.equal(pointsSeenText('fr', 2, 4), '2 points sur 4')
  assert.equal(pointsSeenText('fr', 1, 2), '1 point sur 2')
  assert.equal(pointsSeenText('fr', 0, 2), '0 point sur 2')
  assert.equal(pointsSeenText('en', 1, 2), '1 of 2 points')
  assert.equal(t('fr', 'validatedBefore', { n: 1 }), 'validé au tour 1')
})
