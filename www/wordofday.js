// Weather word of the day: one weather or geography term a day, explained in plain words.
// If something in today's forecast shows the term in action, that term is more likely to be picked,
// and the card says why ("Why today"). Same term all day; "Next term" browses the rest.

// when(d) returns a sentence tying the term to today's weather, or null when it doesn't apply today.
const WORDS = [
  { term: "Rain shadow", what: "The dry side of a mountain range. Wet ocean air is pushed up the mountains, cools, and drops its rain on the near side. By the time it sinks down the far side, it's dry and warming up. That's why deserts often sit right behind tall mountains, like Death Valley behind the Sierra Nevada." },
  { term: "Reflectivity", aka: "Measured in dBZ", what: "How much of a radar's signal bounces back off raindrops, snow or hail. Bigger and more numerous drops send back more, so the number climbs: around 20 dBZ is light rain, 40 is heavy rain, and 60 or more usually means hail. The colors on the radar map are reflectivity.",
    when: (d) => maxPop(d) >= 40 ? `Rain is possible in the next day (up to ${maxPop(d)}%). Watch the radar colors climb from green to yellow as it gets heavier.` : null },
  { term: "Virga", what: "Rain or snow that falls from a cloud but dries up before it reaches the ground. It looks like gray streaks or curtains hanging below the cloud. It happens when the air underneath is very dry, which is common in the West." },
  { term: "Marine layer", aka: "June gloom, May gray", what: "A blanket of cool, moist air that forms over cold ocean water and slides inland at night. It brings low clouds and fog to the coast in the morning, then usually burns off by afternoon as the sun heats the land.",
    when: (d) => /fog|overcast|mist|haze/i.test(d.current.desc || "") && coastal(d) ? `It's ${d.current.desc.toLowerCase()} right now. Near the coast, that's often the marine layer.` : null },
  { term: "Santa Ana winds", what: "Hot, very dry winds that blow from the deserts toward the Southern California coast, mostly in fall and winter. The air sinks and squeezes as it comes down the mountains, which warms and dries it even more. They're famous for raising fire danger.",
    when: (d) => d.alerts.some((a) => /wind|fire|red flag/i.test(a.event)) && socal(d) ? "There's a wind or fire alert in your area today. In Southern California, that often means Santa Ana winds." : null },
  { term: "Dew point", what: "The temperature the air would have to cool to before water starts condensing out of it as dew, fog or clouds. It's a better measure of how muggy it feels than humidity: under 50°F feels dry, 60s feel sticky, over 70 feels tropical.",
    when: (d) => d.current.dewC != null && d.current.tempC != null && d.current.tempC - d.current.dewC <= 2.5 ? `The temperature (${t(d.current.tempC)}) is almost down to the dew point (${t(d.current.dewC)}), so fog or dew is likely.` : null },
  { term: "Inversion", aka: "Temperature inversion", what: "When a layer of warm air sits on top of cooler air near the ground, the opposite of normal. It acts like a lid: smoke, smog and fog get trapped underneath. It's why valleys can be hazy and cold on calm winter mornings.",
    when: (d) => d.aqi?.value > 75 ? `Air quality is ${d.aqi.value} today. Inversions are a common reason pollution builds up instead of blowing away.` : null },
  { term: "Front", aka: "Cold front, warm front", what: "The boundary where two big masses of air with different temperatures meet. A cold front pushes in fast and can bring a sudden line of showers or storms, then cooler, clearer air. A warm front slides in slowly, with long stretches of light rain and gray skies." },
  { term: "Barometric pressure", aka: "Air pressure", what: "The weight of all the air above you pressing down. High pressure means sinking air, which usually brings clear, calm weather. Low pressure means rising air, which forms clouds and storms. A quick drop is one of the oldest signs that bad weather is coming.",
    when: (d) => { const p = pressureTrend(d.current.pressureHpa, d.current.pressure3hAgo); return p && /fall|ris/i.test(p.word) ? `Pressure is ${p.word.toLowerCase()} right now.` : null; } },
  { term: "Jet stream", what: "A narrow river of very fast wind about 6 to 9 miles up, sometimes blowing over 200 mph. It snakes around the globe from west to east and steers storms along with it. When it dips south, cold air and storms follow it." },
  { term: "Atmospheric river", what: "A long, narrow band of very moist air that carries water vapor from the tropics, like a river in the sky. When one hits mountains, it can dump huge amounts of rain and snow. The \"Pineapple Express\" that brings warm rain to California from near Hawaii is one.",
    when: (d) => totalRain(d) >= 25 && westCoast(d) ? `About ${amount(totalRain(d))} of rain is expected in the next day. Big West Coast rain like that often comes from an atmospheric river.` : null },
  { term: "Humidity", aka: "Relative humidity", what: "How full the air is of water vapor compared to the most it could hold at that temperature. 100% means it's full, so fog or dew forms. Warm air can hold much more water than cold air, which is why the same humidity feels very different in summer and winter.",
    when: (d) => d.current.humidity >= 90 ? `Humidity is ${Math.round(d.current.humidity)}% right now. The air is nearly full.` : d.current.humidity != null && d.current.humidity <= 20 ? `Humidity is only ${Math.round(d.current.humidity)}% right now. That's desert-dry air.` : null },
  { term: "Wind chill", what: "How cold it feels on bare skin when wind is blowing. Wind strips away the thin layer of warm air your body keeps around your skin, so you lose heat faster. On a 30°F day, a 20 mph wind makes it feel like about 17°F.",
    when: (d) => d.current.feelsC != null && d.current.tempC - d.current.feelsC >= 2 ? `It's ${t(d.current.tempC)}, but the wind makes it feel like ${t(d.current.feelsC)}.` : null },
  { term: "Heat index", what: "How hot it feels when humidity is high. Your body cools off by sweating, but sweat can't evaporate well in muggy air, so you stay hotter. At 90°F with high humidity, it can feel like over 100°F.",
    when: (d) => d.current.feelsC != null && d.current.feelsC - d.current.tempC >= 2 ? `It's ${t(d.current.tempC)}, but the humidity makes it feel like ${t(d.current.feelsC)}.` : null },
  { term: "Cumulonimbus", what: "The towering thunderstorm cloud. It can grow more than 10 miles tall, with a flat, spreading top called an anvil where it hits the stratosphere. One cloud can hold lightning, hail, heavy rain and even tornadoes.",
    when: (d) => d.hourly.some((h) => /thunder|t-storm/i.test(h.desc)) ? "Thunderstorms are in the forecast, and every thunderstorm is a cumulonimbus cloud." : null },
  { term: "Cumulus", what: "Puffy, cotton-ball clouds with flat bottoms. They form when the sun heats the ground and bubbles of warm air rise, cool and condense. The flat base shows the exact height where the rising air cools to its dew point." },
  { term: "Cirrus", what: "Thin, wispy clouds very high up, made entirely of ice crystals. They often look like brush strokes or horse tails. Cirrus spreading in from one direction can be the first sign a storm system is a day or two away." },
  { term: "Stratus", what: "A flat, gray, featureless layer of low cloud that covers the whole sky. It's basically fog that isn't touching the ground. It can bring drizzle but rarely real rain.",
    when: (d) => /overcast|cloudy/i.test(d.current.desc || "") ? `It's ${d.current.desc.toLowerCase()} right now, which is often a stratus layer.` : null },
  { term: "Lightning", what: "A giant spark between parts of a cloud or between a cloud and the ground. Ice and water bumping around inside a storm build up opposite charges until the air can't hold them apart. A bolt is about five times hotter than the surface of the sun." },
  { term: "Thunder", what: "The sound of lightning. The bolt heats the air so fast it explodes outward. Light reaches you almost instantly but sound travels about a mile every 5 seconds, so counting from the flash to the boom tells you how far away the storm is." },
  { term: "Hail", what: "Balls of ice that fall from strong thunderstorms. Raindrops get carried high into freezing air by updrafts, fall, and get lifted again, adding a layer of ice each trip. Cut a hailstone in half and you can see the rings, like a tree." },
  { term: "Graupel", what: "Soft, crumbly little ice pellets, sometimes called snow pellets. They form when supercooled water droplets freeze onto falling snowflakes. They look like tiny foam balls and bounce when they land." },
  { term: "Supercooled water", what: "Liquid water that's colder than 32°F but hasn't frozen yet, because it has nothing to freeze onto. Clouds are full of it. When it touches a cold surface, like a plane's wing or a road, it freezes instantly into ice." },
  { term: "Freezing rain", what: "Rain that falls as liquid but freezes the moment it hits the cold ground, coating everything in clear ice. It happens when a warm layer of air sits above a thin freezing layer at the surface. It's one of the most dangerous kinds of winter weather." },
  { term: "Frost", what: "Ice crystals that grow straight out of the air onto cold surfaces, without being dew first. It forms on clear, calm nights when the ground loses heat to the sky and cools below freezing, even if the air a few feet up is a little warmer.",
    when: (d) => d.days[0]?.loC != null && d.days[0].loC <= 2 ? `Tonight's low is ${t(d.days[0].loC)}, cold enough for frost on clear, calm patches.` : null },
  { term: "Radiational cooling", what: "How the ground cools off at night by giving off heat to the sky. On clear nights the heat escapes straight to space, so it gets cold fast. Clouds act like a blanket and bounce the heat back, which is why cloudy nights stay warmer.",
    when: (d) => /clear/i.test(d.current.desc || "") && !d.current.isDay ? "It's clear tonight, so the ground can lose heat straight to space." : null },
  { term: "Microclimate", what: "A small area whose weather is different from the area around it. A valley, a hillside facing the sun, a city block full of pavement, or a spot near water can all be several degrees warmer or colder than a mile away. It's why a nearby station can read differently from your yard." },
  { term: "Urban heat island", what: "Cities are warmer than the countryside around them, especially at night. Pavement, roofs and buildings soak up heat all day and release it after dark, and there are fewer trees to cool things down. A big city can be 5 to 10°F warmer at night." },
  { term: "Sea breeze", what: "A cool wind that blows in from the ocean on sunny afternoons. Land heats up faster than water, so warm air rises over the land and cooler ocean air rushes in to replace it. At night it reverses into a land breeze.",
    when: (d) => coastal(d) && d.current.isDay && /sun|clear/i.test(d.current.desc || "") ? "It's sunny near the coast, the classic setup for an afternoon sea breeze." : null },
  { term: "Orographic lift", what: "When wind forces air up the side of a mountain. Rising air cools, and cool air can't hold as much water, so clouds form and rain or snow falls on the upwind side. It's the first half of a rain shadow." },
  { term: "El Niño", aka: "And La Niña", what: "A pattern where the Pacific Ocean near the equator gets unusually warm (El Niño) or cool (La Niña) for months. Because the ocean is so big, it shifts the jet stream and changes weather around the world. El Niño winters are often wetter in Southern California." },
  { term: "Monsoon", what: "A seasonal shift in wind that brings a rainy season. In the US Southwest, summer heat over the desert pulls in moist air from the Gulf of California and Gulf of Mexico, bringing afternoon thunderstorms from July to September." },
  { term: "Tropical cyclone", aka: "Hurricane, typhoon", what: "A spinning storm that forms over warm ocean water and runs on the heat and moisture it draws up. Called a hurricane in the Atlantic and eastern Pacific and a typhoon in the western Pacific. The calm center is the eye." },
  { term: "Tornado", what: "A violently spinning column of air reaching from a thunderstorm down to the ground. Most form from supercells, thunderstorms that rotate. The strongest winds can top 200 mph, but most tornadoes last only a few minutes." },
  { term: "Supercell", what: "A thunderstorm with a deep, rotating updraft called a mesocyclone. They're the most organized and dangerous kind of storm, and produce most large hail and strong tornadoes. On radar they often show a hook shape." },
  { term: "Doppler radar", what: "Radar that measures not just where rain is but which way it's moving, using the same effect that makes a passing siren change pitch. Forecasters use it to spot rotation inside storms, which can warn of tornadoes before they form." },
  { term: "Forecast model", aka: "Weather model", what: "A computer program that solves the physics of the atmosphere to predict the weather. It starts from millions of real measurements, then steps forward minute by minute. The radar forecast in this app comes from a model called HRRR, run every hour." },
  { term: "Precipitation", what: "Any water that falls from the sky: rain, drizzle, snow, sleet, hail or graupel. Fog and dew don't count, because they form at the ground instead of falling.",
    when: (d) => maxPop(d) >= 30 ? `There's up to a ${maxPop(d)}% chance of precipitation in the next 24 hours.` : null },
  { term: "Probability of precipitation", aka: "Chance of rain, PoP", what: "The chance that at least 0.01 inch of rain falls at any one spot in the forecast area during that time. A 40% chance doesn't mean it'll rain 40% of the day. It means 4 out of 10 times with weather like this, your spot gets wet." },
  { term: "Visibility", what: "How far you can see clearly, measured in miles. Fog, heavy rain, snow, smoke and dust all cut it down. Under a quarter mile is dense fog, which is dangerous for driving and flying.",
    when: (d) => d.current.visKm != null && d.current.visKm < 5 ? `Visibility is down to ${vis(d.current.visKm)} right now.` : null },
  { term: "Gust", what: "A short burst of stronger wind lasting a few seconds. Wind isn't smooth: it tumbles over buildings, trees and hills, which makes it speed up and slow down. Gusts are what knock things over.",
    when: (d) => d.current.gustKmh != null && d.current.gustKmh >= 40 ? `Gusts are reaching ${wind(d.current.gustKmh)} right now.` : null },
  { term: "Beaufort scale", what: "A 0 to 12 scale for wind strength based on what you can see, made by a British admiral in 1805. Force 3 moves leaves and small twigs, force 6 makes umbrellas hard to use, and force 12 is hurricane strength.",
    when: (d) => d.current.windKmh >= 30 ? `The wind is ${wind(d.current.windKmh)} right now, about force ${beaufort(d.current.windKmh)} on the Beaufort scale.` : null },
  { term: "UV index", what: "How strong the sun's sunburn rays are, from 0 to 11 or more. It depends mostly on how high the sun is, so it peaks around noon and in summer. Clouds block less of it than you'd think.",
    when: (d) => d.aqi?.uv && d.aqi.uv.peak >= 6 ? `The UV index will reach about ${Math.round(d.aqi.uv.peak)} today. Sunscreen weather.` : null },
  { term: "Ozone", what: "A gas made of three oxygen atoms. High up in the stratosphere, it shields us from the sun's UV rays. Down at ground level, it's a pollutant that forms when sunlight cooks car exhaust, and it peaks on hot, sunny afternoons." },
  { term: "Particulate matter", aka: "PM2.5", what: "Tiny bits of smoke, dust and soot floating in the air. PM2.5 means particles smaller than 2.5 micrometers, about 30 times thinner than a hair, small enough to get deep into your lungs. Wildfire smoke is mostly PM2.5.",
    when: (d) => d.aqi?.pm25 > 25 ? `Fine particles (PM2.5) are elevated today at about ${Math.round(d.aqi.pm25)} micrograms per cubic meter.` : null },
  { term: "Solstice", what: "The two days a year when the sun reaches its highest or lowest point at noon: around June 21 (longest day) and December 21 (shortest day). It happens because Earth is tilted, so each half takes turns leaning toward the sun.",
    when: () => { const n = new Date(); const m = n.getMonth(), day = n.getDate(); return (m === 11 && day >= 14) || (m === 5 && day >= 14 && day <= 28) ? "The solstice is close, so the days are near their shortest or longest of the year." : null; } },
  { term: "Equinox", what: "The two days a year, around March 20 and September 22, when day and night are almost exactly the same length everywhere on Earth. The sun rises due east and sets due west." },
  { term: "Twilight", aka: "Civil, nautical, astronomical", what: "The time before sunrise and after sunset when the sky is lit even though the sun is below the horizon. Civil twilight (sun up to 6° below) is bright enough to see without lights. Astronomical twilight (12 to 18° below) is when the last glow fades and faint stars appear." },
  { term: "Alpenglow", what: "The pink or orange glow on mountains just after sunset or before sunrise, when the valleys are already in shadow. It comes from sunlight that's traveled through so much air that only the red colors are left." },
  { term: "Rayleigh scattering", what: "The reason the sky is blue. Air molecules scatter short blue wavelengths of sunlight much more than red ones, so blue light comes at you from every direction. At sunset, light passes through more air, the blue gets scattered away, and reds and oranges are left.",
    when: (d) => d.current.isDay && /sun|clear/i.test(d.current.desc || "") ? "It's a clear day, so you can see Rayleigh scattering in the blue sky right now." : null },
  { term: "Rainbow", what: "Sunlight bent and reflected inside raindrops, which splits it into colors. You only see one with the sun behind you and rain in front of you, and it's always a circle centered on the shadow of your head. From a plane you can sometimes see the whole circle.",
    when: (d) => d.current.isDay && maxPop(d) >= 30 && /partly|mostly sunny|shower/i.test(d.hourly.map((h) => h.desc).join(" ")) ? "Showers with breaks of sun are possible today. That's rainbow weather: put the sun at your back." : null },
  { term: "Halo", what: "A ring of light around the sun or moon, usually 22° wide (about a hand's width at arm's length). Light bends through six-sided ice crystals in high cirrus clouds. An old saying links a moon halo to rain within a day or two, and it's often right." },
  { term: "Petrichor", what: "The earthy smell after rain hits dry ground. It comes from oils plants release during dry spells and from geosmin, made by soil bacteria. People can smell geosmin at incredibly low amounts, a few parts per trillion.",
    when: (d) => maxPop(d) >= 50 ? "Rain is likely soon. If the ground has been dry, you'll smell petrichor." : null },
  { term: "Watershed", aka: "Drainage basin", what: "All the land where rain and snowmelt drain to the same river, lake or ocean. Ridges and mountains form the edges. A raindrop landing on one side of a ridge can end up in a totally different ocean than one landing on the other." },
  { term: "Continental Divide", what: "The line along the Rocky Mountains (and on through the Andes) that splits North America's water: rain on the west side flows to the Pacific, and rain on the east side flows to the Atlantic or Gulf of Mexico." },
  { term: "Elevation and temperature", aka: "Lapse rate", what: "Air gets cooler as you go up, about 3.5°F for every 1,000 feet on average. That's why mountaintops can have snow while the valley below is warm, and why the same storm can bring rain to the city and snow to the hills." },
  { term: "Latitude", what: "How far north or south of the equator a place is, in degrees from 0 to 90. It's the biggest single control on climate: the closer to the equator, the more directly the sun hits and the warmer it is year round." },
  { term: "Climate vs. weather", what: "Weather is what's happening outside today. Climate is the average over decades: what you'd expect for this place and time of year. As the saying goes, climate is what you expect, weather is what you get. The Almanac in this app shows your local climate." }
];

// --- small helpers used by the "why today" checks ---
const maxPop = (d) => Math.max(0, ...d.hourly.map((h) => h.pop || 0));
const totalRain = (d) => d.hourly.reduce((a, h) => a + (h.rainMm || 0), 0);
const westCoast = () => current && current.lon < -115 && current.lon > -125 && current.lat > 32 && current.lat < 49;
const coastal = () => westCoast() && current.lon < -117.3 + (current.lat - 33) * -0.6;   // rough: within ~30 mi of the CA/OR/WA coast
const socal = () => current && current.lat > 32.4 && current.lat < 35.5 && current.lon < -114.5 && current.lon > -121;
const beaufort = (kmh) => [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118].findIndex((x) => kmh < x) + 1 || 12;

function dayNumber() { const n = new Date(); return Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 864e5) + n.getFullYear() * 400; }

// Today's word: if any terms fit today's weather, pick one of those (the same one all day); otherwise rotate through the list.
function wordOfDay(d, offset = 0) {
  const day = dayNumber();
  const why = (w) => { try { return w.when ? w.when(d) : null; } catch { return null; } };
  const fitting = WORDS.map((w, i) => ({ w, i, why: why(w) })).filter((x) => x.why);
  if (!offset && fitting.length) { const pick = fitting[day % fitting.length]; return { ...pick.w, why: pick.why, index: pick.i }; }
  const base = fitting.length ? fitting[day % fitting.length].i : day % WORDS.length;
  const i = (base + offset) % WORDS.length;
  return { ...WORDS[i], why: why(WORDS[i]), index: i };
}

let wordOffset = 0;
function wordHtml(d) {
  const w = wordOfDay(d, wordOffset);
  return `<details class="alm-all" data-sec="word"${typeof secOpen === "function" ? secOpen("word") : " open"}>
      <summary><h2 class="label">${wordOffset ? "Weather word" : "Weather word of the day"}</h2></summary>
      <div class="word-term">${esc(w.term)}</div>
      ${w.aka ? `<div class="word-aka">${esc(w.aka)}</div>` : ""}
      <p>${esc(w.what)}</p>
      ${w.why ? `<div class="word-why"><div class="k">Why today</div>${esc(w.why)}</div>` : ""}
      <div class="word-more"><button type="button" id="wordNext">Next term</button>${wordOffset ? `<button type="button" id="wordToday">Back to today's</button>` : ""}</div>
    </details>`;
}

function renderWord() {
  const el = $("wordPanel");
  if (!el || !lastData) return;
  el.innerHTML = wordHtml(lastData);
  $("wordNext").addEventListener("click", () => { wordOffset = (wordOffset + 1) % WORDS.length || 1; renderWord(); });
  $("wordToday")?.addEventListener("click", () => { wordOffset = 0; renderWord(); });
}

function mountWord() {
  const slot = $("wordSlot");
  if (!slot) return;
  slot.outerHTML = `<section class="panel word" id="wordPanel" aria-label="Weather word of the day"></section>`;
  renderWord();
}
