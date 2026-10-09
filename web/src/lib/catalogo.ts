// Catálogo inicial de Daniel: ámbito → categoría → subcategorías. Debe coincidir con CATALOGO_INICIAL de Code.gs (lo verifica backend.test.ts).
export const CATALOGO_INICIAL: Record<string, Record<string, string[]>> = {
  "Personal": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Auto": [
      "Gasolina",
      "Gas",
      "Car Wash",
      "Estacionamiento",
      "Mantenimiento",
      "Repuestos",
      "Seguro Vehicular",
      "SOAT",
      "Revisión Técnica",
      "Multas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Servicios": [
      "Línea Celular",
      "Otros"
    ],
    "Suscripciones": [
      "Juegos",
      "ChatGPT",
      "Claude",
      "Cluely",
      "Google",
      "Spotify",
      "Netflix",
      "HBO Max",
      "Prime Video",
      "Crunchyroll",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Regalos",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Salud": [
      "Consultas Médicas",
      "Medicamentos",
      "Exámenes Médicos",
      "Odontología",
      "Otros"
    ],
    "Cuidado Personal": [
      "Barbería / Peluquería",
      "Higiene Personal",
      "Gimnasio",
      "Otros"
    ],
    "Educación": [
      "Maestría",
      "Matrícula",
      "Libros",
      "Certificaciones",
      "Plataformas Educativas",
      "Cursos",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Trabajo": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Herramientas y Equipamiento": [
      "Software Laboral",
      "Equipos de Trabajo",
      "Accesorios",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Pareja": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Plan Nube": [
      "Hospedaje",
      "Cuidado Íntimo",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Regalos": [
      "Detalle Mensual",
      "Fecha Especial",
      "Aniversario",
      "Sorpresas",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Salidas": [
      "Paseos",
      "Cine",
      "Juegos",
      "Diversión",
      "Restaurantes",
      "Actividades Recreativas",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Familia": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Bebé": [
      "Leche",
      "Pañales",
      "Pañitos",
      "Ropa",
      "Alimentación",
      "Juguetes",
      "Accesorios",
      "Consultas Médicas",
      "Medicamentos",
      "Cuidado Infantil",
      "Otros"
    ],
    "Hogar": [
      "Supermercado",
      "Limpieza",
      "Reparaciones",
      "Mantenimiento",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Servicios": [
      "Luz",
      "Agua",
      "Gas",
      "Internet",
      "Línea Celular",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Regalos",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Apoyo Familiar": [
      "Padre",
      "Madre",
      "Pareja",
      "Hija",
      "Hermanos",
      "Apoyo Económico",
      "Regalo Familiar",
      "Otros"
    ],
    "Salud Familiar": [
      "Consultas Médicas",
      "Medicamentos",
      "Exámenes Médicos",
      "Emergencias",
      "Otros"
    ],
    "Educación": [
      "Maestría",
      "Matrícula",
      "Libros",
      "Certificaciones",
      "Plataformas Educativas",
      "Cursos",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Amigos": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Salidas": [
      "Cine",
      "Paseos",
      "Juegos",
      "Diversión",
      "Reuniones",
      "Actividades Deportivas",
      "Otros"
    ],
    "Regalos": [
      "Cumpleaños",
      "Fechas Especiales",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  }
}
