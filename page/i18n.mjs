// Page texts in French and English, picked from the browser language.

export const STRINGS = {
  fr: {
    next: 'Étape suivante',
    prev: 'Étape précédente',
    comment: 'Commenter',
    send: 'Envoyer à Claude',
    finish: 'Terminer la recette',
    sent: "Review envoyée. Claude te répond dans Claude Code. S'il lance un nouveau tour, il s'affichera dans cet onglet.",
    finished: 'Recette terminée. La suite se passe dans Claude Code.',
    reopen: 'Revoir quand même',
    inferred: 'déduit du diff',
    yourComments: "Commentaires sur l'étape",
    nextStep: 'Étape suivante : {title}',
    why: 'Pourquoi cette étape',
    startAt: 'Point de départ',
    skipped: 'Étapes sautées',
    accounts: 'Comptes de test',
    relayDown: 'Le relais ne répond pas. Nouvel essai dans 3 s.',
    gateInstallTitle: "L'extension Review Walkthru n'est pas active dans ce profil Chrome",
    gateInstallBody: 'Installe-la depuis le Chrome Web Store, puis recharge cette page.',
    gateInstallLink: 'Ouvrir la fiche du Chrome Web Store',
    gateUpdateTitle: "Mets à jour l'extension Review Walkthru",
    gateUpdateBody: 'Ouvre chrome://extensions, active le mode développeur et clique sur Mettre à jour, puis recharge cette page.',
    reload: 'Recharger',
    docTitle: 'Recette · PR #{n}',
    endOfRound: 'Fin du tour',
    stepOf: 'Étape {n}/{total}',
    judge: 'À juger',
    then: 'Ensuite',
    colon: ' : ', // French puts a space before the colon
    roundChanged: 'Claude a mis à jour la recette pendant ta review. La page a gardé tes cases et tes commentaires encore valables : vérifie les nouveaux points, puis renvoie.',
    validatedBefore: 'validé au tour {n}',
    add: 'Ajouter',
    cancel: 'Annuler',
    remove: 'Retirer',
    copy: 'Copier',
    dismiss: 'Fermer',
    placeholder: 'Ton commentaire',
    shortcut: '⌘↵ ou Ctrl+↵ pour ajouter',
    openInApp: "Ouvrir dans l'app",
    noScreen: "Pas d'écran : vérifie-le avec les points ci-dessous.",
    ifWrong: "Si c'est faux :",
    tagDecision: 'Décision',
    tagDoubt: 'Doute',
    tagPoint: 'Point',
    tagStep: 'Étape',
    statusValidated: 'Validée',
    statusCommented: 'Commentée',
    statusNotReached: 'Pas vue',
    goTo: 'Revoir',
    rejected: 'Le relais a refusé la review :',
    sending: 'Envoi…',
    login: 'Identifiant',
    password: 'Mot de passe'
  },
  en: {
    next: 'Next step',
    prev: 'Previous step',
    comment: 'Comment',
    send: 'Send to Claude',
    finish: 'Finish the review',
    sent: 'Review sent. Claude replies in Claude Code. If it starts a new round, it will show up in this tab.',
    finished: 'Review finished. Carry on in Claude Code.',
    reopen: 'Review it anyway',
    inferred: 'inferred from the diff',
    yourComments: 'Comments on this step',
    nextStep: 'Next step: {title}',
    why: 'Why this step',
    startAt: 'Start at',
    skipped: 'Skipped steps',
    accounts: 'Test accounts',
    relayDown: 'The relay is not answering. Retrying in 3 s.',
    gateInstallTitle: 'The Review Walkthru extension is not active in this Chrome profile',
    gateInstallBody: 'Install it from the Chrome Web Store, then reload this page.',
    gateInstallLink: 'Open the Chrome Web Store page',
    gateUpdateTitle: 'Update the Review Walkthru extension',
    gateUpdateBody: 'Open chrome://extensions, turn on Developer mode and click Update, then reload this page.',
    reload: 'Reload',
    docTitle: 'Review · PR #{n}',
    endOfRound: 'End of round',
    stepOf: 'Step {n}/{total}',
    judge: 'To judge',
    then: 'Then',
    colon: ': ',
    roundChanged: 'Claude updated the review while you were on it. The page kept the boxes and comments that still apply: check the new points, then send again.',
    validatedBefore: 'validated in round {n}',
    add: 'Add',
    cancel: 'Cancel',
    remove: 'Remove',
    copy: 'Copy',
    dismiss: 'Close',
    placeholder: 'Your comment',
    shortcut: '⌘↵ or Ctrl+↵ to add',
    openInApp: 'Open in the app',
    noScreen: 'No screen: check it with the points below.',
    ifWrong: 'If wrong:',
    tagDecision: 'Decision',
    tagDoubt: 'Doubt',
    tagPoint: 'Point',
    tagStep: 'Step',
    statusValidated: 'Validated',
    statusCommented: 'Commented',
    statusNotReached: 'Not seen',
    goTo: 'Go back',
    rejected: 'The relay refused the review:',
    sending: 'Sending…',
    login: 'Login',
    password: 'Password'
  }
}

export function pickLang (languages) {
  for (const tag of languages) {
    const base = String(tag).toLowerCase().split('-')[0]
    if (base in STRINGS) return base
  }
  return 'en'
}

export function t (lang, key, vars = {}) {
  const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key
  return text.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match)
}

// French uses the singular for 0 and 1, English only for 1.
export function counterText (lang, comments, pointsLeft) {
  const one = n => lang === 'fr' ? n <= 1 : n === 1
  if (lang === 'fr') {
    return `${comments} commentaire${one(comments) ? '' : 's'} · ${pointsLeft} point${one(pointsLeft) ? '' : 's'} à voir`
  }
  return `${comments} comment${one(comments) ? '' : 's'} · ${pointsLeft} point${one(pointsLeft) ? '' : 's'} left`
}

// French: "1 point sur 2", "2 points sur 4". In English the total carries the plural.
export function pointsSeenText (lang, seen, total) {
  if (lang === 'fr') return `${seen} point${seen <= 1 ? '' : 's'} sur ${total}`
  return `${seen} of ${total} point${total === 1 ? '' : 's'}`
}
