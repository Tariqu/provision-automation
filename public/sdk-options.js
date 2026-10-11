const sdkFolderOptions = [
  "DotNet-Kentico",
  "DotNet-MVC",
  "DotNet-Optimizely_Plugin",
  "DotNet-Umbraco_Plugin",
  "DotNet-VB",
  "DotNet-WebForms",
  "Java",
  "Java-AEM",
  "Java-AEM6.5",
  "Java-Hybris",
  "Java-OSGI",
  "JavaScript",
  "Magento_2_Plugin",
  "PHP",
  "PHP-Drupal 7",
  "PHP-Drupal9-11",
  "PHP-Joomla",
  "PHP-Twig",
  "PHP-WordPress",
  "PHP-WordPress_Plugin",
  "PHP-WordPress_Shortcode",
  "Side-Car"
];
function generatedAccountId(value) {
  const number = String(value || '').trim();
  return /^\d{1,14}$/.test(number) ? 'f' + number.padStart(14, '0') : '';
}
if (typeof module !== 'undefined') module.exports = { sdkFolderOptions, generatedAccountId };
