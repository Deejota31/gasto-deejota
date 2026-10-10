import {
  Activity, Ambulance, Apple, ArrowLeftRight, Award, Baby, Backpack, Bandage, Banknote, Bath, Bed, Beef, Beer, Bike, Bird, Bone, Book, BookOpen,
  Briefcase, BriefcaseMedical, Brush, Building, Building2, Bus, Cake, Calculator, Camera, Candy, Car, CarTaxiFront, Carrot, Cat, ChefHat, Cherry,
  Church, Cigarette, Citrus, Clapperboard, Cloud, Code, Coffee, Coins, Construction, CookingPot, CreditCard, Croissant, CupSoda, Dices, Dog,
  Drill, Droplets, Drumstick, Dumbbell, Egg, Eye, Factory, FileText, Film, Fingerprint, Fish, Flame, Flower2, Footprints, Fuel, Gamepad2, Gem,
  Gift, Glasses, Globe, GraduationCap, Grape, Guitar, Ham, Hamburger, Hammer, HandCoins, Handshake, HardHat, Headphones, Heart, HeartHandshake,
  HeartPulse, Hospital, Hotel, House, IceCreamCone, Key, Lamp, Landmark, Laptop, Leaf, Library, Lightbulb, Luggage, Map, MapPin, Martini,
  Megaphone, Mic, Microscope, Milk, Monitor, Mountain, Music, Newspaper, Package, PaintRoller, Palette, PartyPopper, PawPrint, Pencil,
  Percent, Phone, PiggyBank, Pill, Pizza, Plane, Plug, Popcorn, Presentation, Printer, Puzzle, Rabbit, Receipt, Refrigerator, Router, Ruler,
  Salad, Sandwich, Scale, School, Scissors, Shapes, Shield, ShieldCheck, Ship, Shirt, ShoppingBag, ShoppingCart, Shovel, Smartphone, Smile, Sofa,
  Soup, Sparkles, SprayCan, Sprout, SquareParking, Stethoscope, Store, Sun, Syringe, Tablets, Tag, Tent, Theater, Thermometer, Ticket, ToyBrick,
  Tractor, TrainFront, Trash2, TreePine, Trophy, Truck, Tv, Umbrella, User, Users, UtensilsCrossed, Volleyball, Wallet,
  WashingMachine, Watch, Wifi, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react'

/**
 * Catálogo central de iconos. La CLAVE es lo que se guarda en la columna Icono de CATALOGO: nunca cambia
 * (las claves de versiones anteriores se conservan). Cada icono tiene un grupo y sinónimos para la búsqueda
 * y para sugerir iconos según el nombre del ámbito, la categoría o la subcategoría.
 */
export interface IconoDef { key: string; Icon: LucideIcon; grupo: Grupo; sin: string }
export type Grupo = 'Ámbitos y personas' | 'Hogar y servicios' | 'Comida y bebida' | 'Transporte y auto' | 'Salud y cuidado' | 'Bebé y familia'
  | 'Ocio y suscripciones' | 'Compras' | 'Trabajo y educación' | 'Viajes y naturaleza' | 'Mascotas' | 'Dinero' | 'Otros'

export const GRUPOS: Grupo[] = ['Ámbitos y personas', 'Hogar y servicios', 'Comida y bebida', 'Transporte y auto', 'Salud y cuidado', 'Bebé y familia',
  'Ocio y suscripciones', 'Compras', 'Trabajo y educación', 'Viajes y naturaleza', 'Mascotas', 'Dinero', 'Otros']

const D = (key: string, Icon: LucideIcon, grupo: Grupo, sin = ''): IconoDef => ({ key, Icon, grupo, sin })

export const ICONOS: IconoDef[] = [
  // Ámbitos y personas
  D('user', User, 'Ámbitos y personas', 'personal yo persona propio'), D('users', Users, 'Ámbitos y personas', 'familia grupo personas padres'),
  D('heart', Heart, 'Ámbitos y personas', 'pareja amor novia novio esposa'), D('party-popper', PartyPopper, 'Ámbitos y personas', 'amigos fiesta celebracion'),
  D('briefcase', Briefcase, 'Ámbitos y personas', 'trabajo oficina empleo negocio'), D('handshake', Handshake, 'Ámbitos y personas', 'acuerdo socios cliente apoyo'),
  D('heart-handshake', HeartHandshake, 'Ámbitos y personas', 'apoyo ayuda donacion caridad familiar'), D('church', Church, 'Ámbitos y personas', 'iglesia diezmo religion'),
  D('smile', Smile, 'Ámbitos y personas', 'bienestar feliz'),
  // Hogar y servicios
  D('house', House, 'Hogar y servicios', 'hogar casa vivienda alquiler departamento'), D('sofa', Sofa, 'Hogar y servicios', 'muebles sala decoracion'),
  D('bed', Bed, 'Hogar y servicios', 'dormitorio cama colchon'), D('bath', Bath, 'Hogar y servicios', 'baño ducha'),
  D('lamp', Lamp, 'Hogar y servicios', 'iluminacion lampara'), D('washing-machine', WashingMachine, 'Hogar y servicios', 'lavanderia lavadora ropa'),
  D('refrigerator', Refrigerator, 'Hogar y servicios', 'electrodomesticos refrigeradora'), D('trash', Trash2, 'Hogar y servicios', 'basura limpieza arbitrios'),
  D('spray-can', SprayCan, 'Hogar y servicios', 'limpieza productos'), D('zap', Zap, 'Hogar y servicios', 'luz electricidad energia servicios'),
  D('lightbulb', Lightbulb, 'Hogar y servicios', 'luz foco idea'), D('droplets', Droplets, 'Hogar y servicios', 'agua sedapal'),
  D('flame', Flame, 'Hogar y servicios', 'gas balon calefaccion servicios hogar'), D('plug', Plug, 'Hogar y servicios', 'electricidad enchufe'),
  D('wifi', Wifi, 'Hogar y servicios', 'internet fibra wifi'), D('router', Router, 'Hogar y servicios', 'internet modem'),
  D('phone', Phone, 'Hogar y servicios', 'telefono fijo llamadas'), D('smartphone', Smartphone, 'Hogar y servicios', 'celular movil linea plan'),
  D('key', Key, 'Hogar y servicios', 'llaves cerrajeria alquiler'), D('wrench', Wrench, 'Hogar y servicios', 'reparacion mantenimiento herramientas'),
  D('hammer', Hammer, 'Hogar y servicios', 'herramientas construccion arreglo'), D('drill', Drill, 'Hogar y servicios', 'herramientas taladro equipamiento'),
  D('paint-roller', PaintRoller, 'Hogar y servicios', 'pintura remodelacion'), D('shovel', Shovel, 'Hogar y servicios', 'jardin jardineria'),
  D('construction', Construction, 'Hogar y servicios', 'obra construccion'), D('ruler', Ruler, 'Hogar y servicios', 'medidas'),
  // Comida y bebida
  D('utensils', UtensilsCrossed, 'Comida y bebida', 'alimentacion comida restaurante almuerzo cena menu'), D('coffee', Coffee, 'Comida y bebida', 'cafe desayuno cafeteria'),
  D('croissant', Croissant, 'Comida y bebida', 'pan panaderia desayuno'), D('sandwich', Sandwich, 'Comida y bebida', 'sanguche pan chorizo pollo'),
  D('pizza', Pizza, 'Comida y bebida', 'pizza delivery comida rapida'), D('hamburger', Hamburger, 'Comida y bebida', 'hamburguesa comida rapida kfc'),
  D('drumstick', Drumstick, 'Comida y bebida', 'pollo broaster norkys'), D('beef', Beef, 'Comida y bebida', 'carne parrilla'),
  D('ham', Ham, 'Comida y bebida', 'jamon embutidos'), D('fish', Fish, 'Comida y bebida', 'pescado cebiche mariscos'),
  D('soup', Soup, 'Comida y bebida', 'sopa caldo cena'), D('salad', Salad, 'Comida y bebida', 'ensalada saludable'),
  D('cooking-pot', CookingPot, 'Comida y bebida', 'cocina ollas'), D('chef-hat', ChefHat, 'Comida y bebida', 'cocina chef'),
  D('egg', Egg, 'Comida y bebida', 'huevos mercado'), D('milk', Milk, 'Comida y bebida', 'leche lacteos yogurt'),
  D('apple', Apple, 'Comida y bebida', 'fruta mercado'), D('carrot', Carrot, 'Comida y bebida', 'verduras mercado'),
  D('grape', Grape, 'Comida y bebida', 'fruta uvas'), D('cherry', Cherry, 'Comida y bebida', 'fruta'), D('citrus', Citrus, 'Comida y bebida', 'limon fruta'),
  D('candy', Candy, 'Comida y bebida', 'dulces golosinas snack antojos'), D('ice-cream', IceCreamCone, 'Comida y bebida', 'helado postre antojos'),
  D('cake', Cake, 'Comida y bebida', 'torta postre cumpleaños'), D('popcorn', Popcorn, 'Comida y bebida', 'canchita snack cine'),
  D('cup-soda', CupSoda, 'Comida y bebida', 'gaseosa bebidas refresco'), D('beer', Beer, 'Comida y bebida', 'cerveza bar'),
  D('wine', Wine, 'Comida y bebida', 'vino licor'), D('martini', Martini, 'Comida y bebida', 'tragos coctel bar'),
  // Transporte y auto
  D('car', Car, 'Transporte y auto', 'auto carro vehiculo'), D('fuel', Fuel, 'Transporte y auto', 'gasolina combustible grifo gas glp auto'),
  D('parking', SquareParking, 'Transporte y auto', 'estacionamiento cochera parqueo'), D('taxi', CarTaxiFront, 'Transporte y auto', 'taxi uber cabify mototaxi'),
  D('bus', Bus, 'Transporte y auto', 'transporte bus micro combi'), D('train', TrainFront, 'Transporte y auto', 'tren metro'),
  D('bike', Bike, 'Transporte y auto', 'bicicleta moto delivery'), D('truck', Truck, 'Transporte y auto', 'mudanza envio flete'),
  D('ship', Ship, 'Transporte y auto', 'barco ferry'), D('shield', Shield, 'Transporte y auto', 'seguro soat vehicular'),
  D('shield-check', ShieldCheck, 'Transporte y auto', 'revision tecnica seguro'),
  // Salud y cuidado
  D('stethoscope', Stethoscope, 'Salud y cuidado', 'salud medico consulta doctor'), D('heart-pulse', HeartPulse, 'Salud y cuidado', 'salud cardiologia chequeo'),
  D('pill', Pill, 'Salud y cuidado', 'medicinas farmacia pastillas'), D('tablets', Tablets, 'Salud y cuidado', 'medicamentos farmacia'),
  D('syringe', Syringe, 'Salud y cuidado', 'vacunas inyeccion'), D('hospital', Hospital, 'Salud y cuidado', 'clinica hospital emergencia'),
  D('ambulance', Ambulance, 'Salud y cuidado', 'emergencia'), D('briefcase-medical', BriefcaseMedical, 'Salud y cuidado', 'botiquin seguro medico'),
  D('bandage', Bandage, 'Salud y cuidado', 'curacion'), D('thermometer', Thermometer, 'Salud y cuidado', 'fiebre'),
  D('microscope', Microscope, 'Salud y cuidado', 'laboratorio analisis examenes'), D('eye', Eye, 'Salud y cuidado', 'oftalmologia vista'),
  D('glasses', Glasses, 'Salud y cuidado', 'lentes optica'), D('activity', Activity, 'Salud y cuidado', 'odontologia dentista terapia'),
  D('dumbbell', Dumbbell, 'Salud y cuidado', 'gimnasio gym deporte'), D('sparkles', Sparkles, 'Salud y cuidado', 'cuidado personal belleza estetica'),
  D('scissors', Scissors, 'Salud y cuidado', 'peluqueria corte barberia'), D('brush', Brush, 'Salud y cuidado', 'maquillaje cosmeticos cuidado intimo'),
  D('fingerprint', Fingerprint, 'Salud y cuidado', 'personal higiene'),
  // Bebé y familia
  D('baby', Baby, 'Bebé y familia', 'bebe pañales leche cuidado infantil niñera'), D('toy-brick', ToyBrick, 'Bebé y familia', 'juguetes niños'),
  D('puzzle', Puzzle, 'Bebé y familia', 'juegos niños estimulacion'), D('hand-coins', HandCoins, 'Bebé y familia', 'apoyo familiar propina madre padre mesada'),
  D('footprints', Footprints, 'Bebé y familia', 'zapatos calzado niños'),
  // Ocio y suscripciones
  D('tv', Tv, 'Ocio y suscripciones', 'suscripciones streaming netflix hbo cable'), D('film', Film, 'Ocio y suscripciones', 'cine peliculas salidas'),
  D('clapperboard', Clapperboard, 'Ocio y suscripciones', 'cine series'), D('music', Music, 'Ocio y suscripciones', 'spotify musica conciertos'),
  D('headphones', Headphones, 'Ocio y suscripciones', 'audio podcast'), D('mic', Mic, 'Ocio y suscripciones', 'karaoke'),
  D('gamepad', Gamepad2, 'Ocio y suscripciones', 'juegos videojuegos consola war'), D('dices', Dices, 'Ocio y suscripciones', 'juegos de mesa apuestas'),
  D('ticket', Ticket, 'Ocio y suscripciones', 'entradas eventos juegos mecanicos'), D('theater', Theater, 'Ocio y suscripciones', 'teatro show'),
  D('trophy', Trophy, 'Ocio y suscripciones', 'deporte competencia futbol'), D('volleyball', Volleyball, 'Ocio y suscripciones', 'deporte pelota'),
  D('guitar', Guitar, 'Ocio y suscripciones', 'instrumentos clases musica'), D('palette', Palette, 'Ocio y suscripciones', 'arte hobby'),
  D('camera', Camera, 'Ocio y suscripciones', 'fotografia'), D('cloud', Cloud, 'Ocio y suscripciones', 'nube plan nube almacenamiento google'),
  D('newspaper', Newspaper, 'Ocio y suscripciones', 'diario revista noticias'), D('cigarette', Cigarette, 'Ocio y suscripciones', 'cigarros vicios'),
  // Compras
  D('shopping-bag', ShoppingBag, 'Compras', 'compras ropa tienda'), D('shopping-cart', ShoppingCart, 'Compras', 'supermercado mercado abarrotes'),
  D('store', Store, 'Compras', 'tienda bodega'), D('package', Package, 'Compras', 'pedido envio amazon'),
  D('shirt', Shirt, 'Compras', 'ropa vestimenta'), D('watch', Watch, 'Compras', 'accesorios reloj'),
  D('gem', Gem, 'Compras', 'joyas accesorios'), D('gift', Gift, 'Compras', 'regalos cumpleaños navidad'),
  D('laptop', Laptop, 'Compras', 'tecnologia computadora'), D('monitor', Monitor, 'Compras', 'tecnologia pantalla'),
  D('printer', Printer, 'Compras', 'impresiones oficina'),
  // Trabajo y educación
  D('graduation-cap', GraduationCap, 'Trabajo y educación', 'educacion universidad maestria'), D('school', School, 'Trabajo y educación', 'colegio pension'),
  D('book', Book, 'Trabajo y educación', 'libros lectura'), D('book-open', BookOpen, 'Trabajo y educación', 'curso estudio'),
  D('library', Library, 'Trabajo y educación', 'biblioteca'), D('backpack', Backpack, 'Trabajo y educación', 'utiles escolares mochila'),
  D('pencil', Pencil, 'Trabajo y educación', 'utiles papeleria'), D('calculator', Calculator, 'Trabajo y educación', 'contabilidad impuestos'),
  D('code', Code, 'Trabajo y educación', 'software programacion herramientas'), D('presentation', Presentation, 'Trabajo y educación', 'certificaciones capacitacion'),
  D('award', Award, 'Trabajo y educación', 'certificaciones logros'), D('megaphone', Megaphone, 'Trabajo y educación', 'publicidad marketing'),
  D('building', Building2, 'Trabajo y educación', 'empresa edificio oficina'), D('building-1', Building, 'Trabajo y educación', 'banco institucion'),
  D('factory', Factory, 'Trabajo y educación', 'industria'), D('hard-hat', HardHat, 'Trabajo y educación', 'obra seguridad'),
  D('file-text', FileText, 'Trabajo y educación', 'tramites documentos notaria'),
  // Viajes y naturaleza
  D('plane', Plane, 'Viajes y naturaleza', 'viajes vuelos avion'), D('luggage', Luggage, 'Viajes y naturaleza', 'equipaje viaje'),
  D('hotel', Hotel, 'Viajes y naturaleza', 'hotel hospedaje alojamiento'), D('tent', Tent, 'Viajes y naturaleza', 'camping'),
  D('map', Map, 'Viajes y naturaleza', 'turismo tour'), D('map-pin', MapPin, 'Viajes y naturaleza', 'lugar destino'),
  D('globe', Globe, 'Viajes y naturaleza', 'internacional'), D('mountain', Mountain, 'Viajes y naturaleza', 'excursion'),
  D('umbrella', Umbrella, 'Viajes y naturaleza', 'playa'), D('sun', Sun, 'Viajes y naturaleza', 'verano vacaciones'),
  D('tree', TreePine, 'Viajes y naturaleza', 'naturaleza parque'), D('leaf', Leaf, 'Viajes y naturaleza', 'plantas'),
  D('flower', Flower2, 'Viajes y naturaleza', 'flores jardin'), D('sprout', Sprout, 'Viajes y naturaleza', 'huerto'), D('tractor', Tractor, 'Viajes y naturaleza', 'campo'),
  // Mascotas
  D('paw-print', PawPrint, 'Mascotas', 'mascotas veterinaria'), D('dog', Dog, 'Mascotas', 'perro mascota'), D('cat', Cat, 'Mascotas', 'gato mascota'),
  D('bone', Bone, 'Mascotas', 'comida mascota'), D('bird', Bird, 'Mascotas', 'ave'), D('rabbit', Rabbit, 'Mascotas', 'conejo'),
  // Dinero
  D('wallet', Wallet, 'Dinero', 'billetera efectivo otros'), D('banknote', Banknote, 'Dinero', 'efectivo dinero sueldo'),
  D('coins', Coins, 'Dinero', 'monedas propina'), D('piggy-bank', PiggyBank, 'Dinero', 'ahorro'), D('landmark', Landmark, 'Dinero', 'banco impuestos sunat'),
  D('credit-card', CreditCard, 'Dinero', 'tarjeta credito comisiones'), D('receipt', Receipt, 'Dinero', 'recibo boleta pagos'),
  D('percent', Percent, 'Dinero', 'intereses comisiones descuento'), D('scale', Scale, 'Dinero', 'legal abogado'),
  D('transfer', ArrowLeftRight, 'Dinero', 'transferencia'),
  // Otros
  D('tag', Tag, 'Otros', 'etiqueta otros general'), D('shapes', Shapes, 'Otros', 'otros varios'),
]

/** Mapa clave → icono (incluye las claves de versiones anteriores). */
export const ICONS: Record<string, LucideIcon> = Object.fromEntries(ICONOS.map(i => [i.key, i.Icon]))
export const iconoPorClave = (key: string | undefined | null): LucideIcon => (key && ICONS[key]) || Tag

const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tokens = (s: string) => plano(s).split(/[^a-z0-9ñ]+/).filter(t => t.length > 2)

/** Busca por clave, grupo o sinónimos (sin tildes ni mayúsculas). */
export function buscarIconos(q: string): IconoDef[] {
  const t = plano(q.trim())
  if (!t) return ICONOS
  return ICONOS.filter(i => plano(`${i.key} ${i.grupo} ${i.sin}`).includes(t))
}

/**
 * Sugerencias contextuales: puntúa cada icono por coincidencias entre sus sinónimos y el nombre que escribes
 * (peso alto) y los de su ámbito/categoría (peso bajo). Nunca restringe: los demás iconos siguen disponibles.
 */
export function sugerirIconos(nombre: string, contexto: string[] = [], max = 12): IconoDef[] {
  const propios = tokens(nombre), ctx = contexto.flatMap(tokens)
  const score = (i: IconoDef) => {
    const sin = tokens(`${i.key} ${i.sin}`)
    const hit = (t: string) => sin.some(s => s === t || (t.length >= 4 && s.startsWith(t)) || (s.length >= 5 && t.startsWith(s)))
    return propios.filter(hit).length * 3 + ctx.filter(hit).length
  }
  return ICONOS.map(i => ({ i, s: score(i) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map(x => x.i)
}
