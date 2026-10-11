async function fillFirst(page, selectors, value, label) {
  for (const selector of selectors.filter(Boolean)) {
    const matches = page.locator(selector);
    for (let index = 0; index < await matches.count(); index++) {
      const locator = matches.nth(index);
      if (!await locator.isVisible() || !await locator.isEnabled() || !await locator.isEditable()) continue;
      await locator.fill(String(value ?? ''));
      return selector;
    }
  }

  throw new Error(`Could not find a visible, enabled, editable field for ${label}`);
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors.filter(Boolean)) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return selector;
    }
  }

  throw new Error(`Could not find clickable control for ${label}`);
}

async function checkFirst(page, selectors, label) {
  for (const selector of selectors.filter(Boolean)) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      const checked = await locator.isChecked().catch(() => false);
      if (!checked) {
        await locator.check({ force: true }).catch(async () => {
          await locator.click({ force: true });
        });
      }
      return selector;
    }
  }

  if (label) {
    try {
      const labelLocator = page.getByLabel(label).first();
      if (await labelLocator.count()) {
        const checked = await labelLocator.isChecked().catch(() => false);
        if (!checked) {
          await labelLocator.check({ force: true }).catch(async () => {
            await labelLocator.click({ force: true });
          });
        }
        return `label:${label}`;
      }
    } catch (_) {}
  }

  throw new Error(`Could not find checkbox or radio button for ${label}`);
}

async function optionalClick(page, selectors) {
  for (const selector of selectors.filter(Boolean)) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return true;
    }
  }

  return false;
}

async function waitForSettled(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

function accountOrigin(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

module.exports = {
  accountOrigin,
  checkFirst,
  clickFirst,
  fillFirst,
  optionalClick,
  waitForSettled
};
