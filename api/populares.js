// Lo que más busca la gente, para quien llega sin historial propio.

import { populares } from './consulta.js';

export default function handler(req, res) {
  const lista = [...populares.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([texto]) => texto);
  res.status(200).json({ populares: lista });
}
