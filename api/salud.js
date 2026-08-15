// Estado del despliegue, sin revelar ningún valor: sólo si las variables están
// presentes. Sirve para distinguir "no llegó la configuración" de "Google la
// rechazó", que son problemas distintos y se arreglan distinto.

export default function handler(req, res) {
  const bitacora = process.env.BITACORA_URL
    ? 'apps-script'
    : process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY && process.env.SHEET_ID
      ? 'cuenta-de-servicio'
      : 'apagada';
  res.status(200).json({
    ok: true,
    bitacora,
    tokenPresente: !!process.env.BITACORA_TOKEN,
  });
}
