const target = process.env.UI_TEST_URL?.trim();

if (!target) {
  console.error('UI_TEST_URL is required for test:ui:deployed');
  process.exit(1);
}
