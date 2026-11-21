"use strict";
// Chores: rotating daily, weekly and monthly chores for the kids, with swaps, a joke and a fun fact of the day,
// and a slide-out "what to wear" panel fed by the live forecast. Everything is saved on this device only (lw.chores).
// Globals it reads from index.html: $, store, lastData, t, cToF. It adds window.showChores and window.refreshChoresWeather.
// Wrapped in an IIFE because top-level const names collide across classic scripts.
(() => {
  const KEY = "lw.chores";
  const LISTS = [["daily", "Daily chores", "Done every day."], ["weekly", "Weekly chores", "Done once a week."], ["monthly", "Monthly chores", "Done once a month."]];
  const KID_COLORS = ["#8b5cf6", "#0d9488", "#ea580c", "#2563eb", "#db2777", "#65a30d", "#0891b2", "#a16207"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Generic starting point. Real names and chores are typed in the app and stay on the device, not in this public repo.
  const DEF = {
    kids: ["Kid 1", "Kid 2", "Kid 3", "Kid 4"],
    daily: ["Empty or load the dishwasher", "Set and clear the table", "Empty the kitchen trash", "Feed the pets"],
    weekly: ["Vacuum the living room", "Clean the bathrooms", "Take the bins to the curb", "Wipe the counters and sweep the kitchen"],
    monthly: ["Wash the windows", "Clean out the fridge", "Tidy the garage", "Dust the baseboards and vents"]
  };

  // One joke and one fun fact a day, picked by date (the day turns over at 6 AM). They repeat after a couple of months.
  const JOKES = [
    ["Why did the scarecrow win an award?", "He was outstanding in his field."],
    ["What do you call a bear with no teeth?", "A gummy bear."],
    ["What do you call cheese that isn't yours?", "Nacho cheese."],
    ["Why did the bicycle fall over?", "It was two tired."],
    ["What do you call a sleeping dinosaur?", "A dino-snore."],
    ["Why don't eggs tell jokes?", "They'd crack each other up."],
    ["What did the ocean say to the beach?", "Nothing, it just waved."],
    ["Why did the cookie go to the doctor?", "It felt crummy."],
    ["What do you call a fish wearing a bowtie?", "Sofishticated."],
    ["How do you make a tissue dance?", "Put a little boogie in it."],
    ["Why did the math book look sad?", "It had too many problems."],
    ["What's orange and sounds like a parrot?", "A carrot."],
    ["What do you call a dinosaur that crashes his car?", "Tyrannosaurus wrecks."],
    ["What did one wall say to the other?", "I'll meet you at the corner."],
    ["Why are ghosts bad liars?", "You can see right through them."],
    ["What do you call a pig that does karate?", "A pork chop."],
    ["What do you get when you cross a snowman and a vampire?", "Frostbite."],
    ["What has hands but can't clap?", "A clock."],
    ["Why was the broom late?", "It over-swept."],
    ["What do elves learn in school?", "The elf-abet."],
    ["What do you call a boomerang that won't come back?", "A stick."],
    ["Why did the tomato turn red?", "It saw the salad dressing."],
    ["What kind of tree fits in your hand?", "A palm tree."],
    ["What's a cat's favorite color?", "Purr-ple."],
    ["What do you call a snowman in July?", "A puddle."],
    ["Why did the banana go to the doctor?", "It wasn't peeling well."],
    ["How does the moon cut his hair?", "Eclipse it."],
    ["What do you call a bee that can't make up its mind?", "A maybe."],
    ["Why did the kid bring a ladder to school?", "He wanted to go to high school."],
    ["What do you call a dog magician?", "A labracadabrador."],
    ["Why can't a nose be 12 inches long?", "Because then it would be a foot."],
    ["What did the traffic light say to the car?", "Don't look, I'm changing!"],
    ["Why did the music teacher need a ladder?", "To reach the high notes."],
    ["What's a computer's favorite snack?", "Microchips."],
    ["What do you call an alligator in a vest?", "An investigator."],
    ["Why do bees have sticky hair?", "They use honeycombs."],
    ["What did the zero say to the eight?", "Nice belt."],
    ["What do you call a sleeping bull?", "A bulldozer."],
    ["Why did the picture go to jail?", "It was framed."],
    ["What do you call a fake noodle?", "An impasta."],
    ["What did the baby corn say to the mama corn?", "Where's popcorn?"],
    ["Why was the computer cold?", "It left its windows open."],
    ["What did the janitor say when he jumped out of the closet?", "Supplies!"],
    ["Why do cows wear bells?", "Because their horns don't work."],
    ["What do you call two birds in love?", "Tweethearts."],
    ["What's a ghost's favorite fruit?", "Boo-berries."],
    ["Why was the belt arrested?", "It held up a pair of pants."],
    ["What kind of shoes do spies wear?", "Sneakers."],
    ["Why did the skeleton skip the party?", "He had no body to go with."],
    ["What do you call a duck that gets all A's?", "A wise quacker."],
    ["What do you call a lazy kangaroo?", "A pouch potato."],
    ["Why did the chicken join a band?", "It had the drumsticks."],
    ["What do you call a witch at the beach?", "A sand-witch."],
    ["Why do fish live in salt water?", "Because pepper makes them sneeze."],
    ["Why couldn't the pony talk?", "He was a little hoarse."],
    ["What did the buffalo say when his son left for school?", "Bison."],
    ["How do you organize a space party?", "You planet."],
    ["Why did the cat sit on the computer?", "To keep an eye on the mouse."],
    ["How does a penguin build its house?", "Igloos it together."],
    ["Why did the pizza maker go broke?", "He just couldn't make enough dough."],
    ["What do you call a pile of kittens?", "A meow-ntain."],
    ["Why don't skeletons fight each other?", "They don't have the guts."],
    ["Why did the orange stop rolling?", "It ran out of juice."],
    ["Knock knock. Who's there? Boo. Boo who?", "Don't cry, it's only a joke!"],
    ["Knock knock. Who's there? Lettuce. Lettuce who?", "Lettuce in, it's cold out here!"],
    ["What do you call a train carrying bubble gum?", "A chew-chew train."],
    ["Why was the math teacher late?", "She took the rhombus."],
    ["What do you call a cow with no legs?", "Ground beef."],
    ["Why did the golfer bring two pairs of pants?", "In case he got a hole in one."],
    ["What do you call a sheep with no legs?", "A cloud."],
    ["What did the sink say to the faucet?", "You're a real drip."],
    ["Why did the student eat his homework?", "The teacher said it was a piece of cake."],
    ["What do you call a droid that takes the long way around?", "R2 detour."],
    ["What is a vampire's favorite fruit?", "A blood orange."],
    ["Why is the sidewalk so tired?", "Everybody walks all over it."]
  ];
  const FACTS = [
    "An octopus has three hearts and blue blood.",
    "Honey can last for thousands of years without spoiling, because it has so little water in it.",
    "A day on Venus is longer than a year on Venus.",
    "Bananas are berries, but strawberries are not.",
    "Sharks were swimming in the oceans before there were trees on Earth.",
    "A group of flamingos is called a flamboyance.",
    "Wombats are the only animals known to make cube-shaped poop.",
    "On a hot day the Eiffel Tower can grow a few inches taller, because metal expands when it heats up.",
    "Lightning can be about five times hotter than the surface of the Sun.",
    "Butterflies taste with their feet.",
    "Cows have best friends, and they get less stressed when their friend is nearby.",
    "The Moon is drifting away from Earth by about an inch and a half every year.",
    "A giraffe has the same number of neck bones as you do: seven. Theirs are just much longer.",
    "Crows can recognize human faces and remember who was kind or unkind to them.",
    "Sea otters sometimes hold hands while they sleep so they don't drift apart.",
    "Dolphins sleep with half of their brain at a time.",
    "Polar bears have black skin under their white-looking fur.",
    "Saturn is so light for its size that it would float in a bathtub, if you could find one big enough.",
    "The Sun holds about 99.8% of all the mass in our whole solar system.",
    "Sunlight takes about eight minutes to reach Earth.",
    "A year on Mercury lasts only 88 Earth days.",
    "Jupiter's Great Red Spot is a giant storm wider than Earth, and it has been swirling for hundreds of years.",
    "Astronauts can grow up to two inches taller in space, because their spines stretch out without gravity.",
    "Honeybees do a wiggle dance to tell their friends where the flowers are.",
    "Ants can carry things that weigh many times more than they do.",
    "Dragonflies were flying around before the dinosaurs.",
    "Some kinds of bamboo can grow almost three feet in a single day.",
    "Coast redwood trees can grow taller than 350 feet.",
    "Cheetahs are the fastest land animals and can run about 60 miles per hour.",
    "Elephants can't jump.",
    "Owls can turn their heads about 270 degrees, which is almost all the way around.",
    "A giraffe's tongue is about 20 inches long and is dark purple.",
    "Fireflies make light without making much heat. That's called cold light.",
    "Ice floats because frozen water takes up more space than liquid water.",
    "Popcorn pops because the tiny drop of water inside turns to steam and bursts the kernel.",
    "Carrots used to be purple or yellow. Orange ones came later.",
    "Apples float because about a quarter of an apple is air.",
    "A pineapple takes about two years to grow.",
    "A group of owls is called a parliament.",
    "A group of kangaroos is called a mob.",
    "Seahorse dads carry the babies, not the moms.",
    "Emperor penguin dads keep the egg warm on top of their feet.",
    "The space station circles Earth about every 90 minutes, so astronauts see about 16 sunrises a day.",
    "A camel's hump stores fat, not water.",
    "Your brain uses about a fifth of all the energy your body makes.",
    "The smallest bones in your body are in your ears. The tiniest one is about the size of a grain of rice.",
    "Babies are born with about 300 bones, but grown-ups have 206, because some bones join together.",
    "A peregrine falcon can dive faster than 200 miles per hour.",
    "Bats are the only mammals that can truly fly.",
    "An octopus can squeeze through any space bigger than its beak.",
    "Antarctica is the biggest desert in the world, because it gets so little rain or snow.",
    "The Pacific Ocean is bigger than all of Earth's land put together.",
    "Sound travels about four times faster through water than through air.",
    "You can guess how far away lightning is: every five seconds between the flash and the thunder is about one mile.",
    "A rainbow is really a full circle. From the ground we usually see only the top half.",
    "A cloud can weigh more than a million pounds. It floats because that weight is spread out over a huge space.",
    "Hummingbirds can fly backward and hover in place.",
    "Koalas have fingerprints that look a lot like human fingerprints.",
    "A dog's nose print is one of a kind, just like a human fingerprint.",
    "Goldfish can remember things for months.",
    "A shrimp's heart is in its head.",
    "Starfish don't have a brain.",
    "Baby spiders can travel through the air by floating on strands of silk.",
    "Footprints on the Moon could last for millions of years, because there's no wind or rain to wash them away.",
    "The Sahara Desert used to be green, with lakes and grasslands, thousands of years ago.",
    "Alaska has more coastline than all the other US states put together.",
    "A teaspoon of material from a neutron star would weigh billions of tons.",
    "The top of Mount Everest is about 29,000 feet above sea level.",
    "Your stomach makes a new lining every few days.",
    "People blink about 15 to 20 times a minute.",
    "Your skin is your body's biggest organ.",
    "Some kinds of turtles can take in oxygen through their back ends.",
    "Venus is hotter than Mercury, even though it's farther from the Sun, because its thick air traps heat.",
    "A blue whale is the biggest animal known to have ever lived on Earth.",
    "Some penguins give their mate a pebble as a gift.",
    "Cats can't taste sweet things.",
    "Lightning strikes somewhere on Earth about 100 times every second.",
    "Every snowflake has six sides or points.",
    "Earth spins at about 1,000 miles per hour at the equator, and you don't feel a thing.",
    "Olympus Mons, a volcano on Mars, is about two and a half times as tall as Mount Everest.",
    "Venus spins backward compared with most of the other planets."
  ];

  // ---------- small helpers ----------
  const mod = (a, n) => ((a % n) + n) % n;
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const dayNum = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  const monthKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
  const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - mod(x.getDay() + 6, 7)); x.setHours(12, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const newId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const noon = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (k === "class") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "value" || k === "disabled") e[k] = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((c) => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }

  // ---------- chores and saved state ----------
  // Each chore is {id, t: text, pin: kid number or null}. A rotating chore moves one kid to the right each week (monthly: each month).
  function normList(arr) {
    const seen = {};
    return (Array.isArray(arr) ? arr : []).map((x, i) => {
      let id = typeof x === "string" ? "s" + i : String(x && x.id != null ? x.id : "s" + i);
      while (seen[id]) id += "x";
      seen[id] = true;
      return typeof x === "string" ? { id, t: x, pin: null }
        : { id, t: String((x && x.t) || ""), pin: (x && Number.isInteger(x.pin) && x.pin >= 0) ? x.pin : null };
    });
  }
  function normalize(c) {
    c = c || {};
    const out = {
      kids: Array.isArray(c.kids) && c.kids.length >= 2 ? c.kids.map(String).slice(0, 8) : DEF.kids.slice(),
      anchor: /^\d{4}-\d{2}-\d{2}$/.test(c.anchor || "") ? c.anchor : ymd(monday(new Date()))
    };
    LISTS.forEach(([l]) => { out[l] = normList(Array.isArray(c[l]) ? c[l] : DEF[l]); });
    return out;
  }
  const saved = store.get(KEY);
  let cfg = normalize(saved && saved.cfg), checks = (saved && saved.checks) || {}, ovr = (saved && saved.ovr) || {};
  const save = () => store.set(KEY, { cfg, checks, ovr });
  if (!saved) save();           // keep the starting week from changing on the next visit

  const n = () => cfg.kids.length;
  const okKid = (v) => Number.isInteger(v) && v >= 0 && v < n();
  const weekShift = (mon) => Math.round((dayNum(mon) - dayNum(monday(parse(cfg.anchor)))) / 7);
  const monthShift = (d) => { const a = parse(cfg.anchor); return (d.getFullYear() * 12 + d.getMonth()) - (a.getFullYear() * 12 + a.getMonth()); };
  function scopeKey(list, scope, id, date) {
    const p = scope === "d" ? ymd(date) : scope === "w" ? ymd(monday(date)) : monthKey(date);
    return list + ":" + scope + ":" + p + ":" + id;
  }
  const appliedKeys = (list, id, date) => (list === "daily" ? ["d", "w"] : list === "weekly" ? ["w"] : ["m"]).map((s) => scopeKey(list, s, id, date));
  // Rotating chores are dealt out in list order, one kid at a time; pinned and blank chores don't use up a turn.
  function rotRank(list, pos) {
    let r = 0;
    for (let i = 0; i < pos; i++) { const c = cfg[list][i]; if (c.t && !okKid(c.pin)) r++; }
    return r;
  }
  // Who holds the chore at position pos on a date: a swap wins, then a pin, then the rotation.
  function holderOn(list, pos, date, noDay) {
    const c = cfg[list][pos], ks = appliedKeys(list, c.id, date);
    for (let i = 0; i < ks.length; i++) {
      if (noDay && list === "daily" && i === 0) continue;
      if (okKid(ovr[ks[i]])) return ovr[ks[i]];
    }
    if (okKid(c.pin)) return c.pin;
    return mod(rotRank(list, pos) + (list === "monthly" ? monthShift(date) : weekShift(monday(date))), n());
  }
  function tasksFor(k, date) {
    const out = [];
    [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly · " + MONTHS[date.getMonth()]]].forEach(([list, tag]) => {
      cfg[list].forEach((c, pos) => {
        if (!c.t || holderOn(list, pos, date) !== k) return;
        const key = (list === "daily" ? "d:" + ymd(date) : list === "weekly" ? "w:" + ymd(monday(date)) : "m:" + monthKey(date)) + ":" + c.id;
        out.push({ list, tag, c, pos, key });
      });
    });
    return out;
  }

  // ---------- screen ----------
  let built = false, view = noon(new Date()), followToday = true, swap = null, punchOpen = "", lastAdded = null, drawerOpen = false;
  const root = () => document.getElementById("choresRoot");
  const q = (id) => document.getElementById(id);

  function addStyles() {
    const s = document.createElement("style");
    s.textContent = `
.ch { display: grid; gap: 16px; min-width: 0; }
.ch h2.label { margin: 0; }
.ch-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.ch-sub { color: var(--muted); font-size: .85rem; }
.ch-nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ch-week { font: 600 1.1rem var(--display); min-width: 8.5rem; text-align: center; }
.ch-btn { min-height: 44px; padding: 0 16px; border-radius: 22px; font-weight: 600; }
.ch-btn:disabled { opacity: .5; cursor: default; }
.ch-btn.pri { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.ch-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.ch-day { background: var(--surface); border: 1px solid var(--line); min-height: 56px; border-radius: 12px; padding: 4px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.15; font-weight: 600; }
.ch-day small { font-weight: 500; color: var(--muted); font-size: .72rem; }
.ch-day[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.ch-day[aria-pressed="true"] small { color: var(--bg); opacity: .85; }
.ch-day.today:not([aria-pressed="true"]) { border-color: var(--accent); }
.ch-daily { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.ch-daily[hidden] { display: none; }
.ch-daily p { margin: 0; font-size: 1.05rem; }
.ch-daily .pl { margin-top: 8px; font-weight: 700; }
.ch-daily .label { margin-bottom: 4px; }
.ch-daily button { min-height: 44px; border-radius: 22px; padding: 0 16px; font-weight: 700; margin-top: 8px; color: var(--accent); border-color: var(--accent); background: transparent; }
@media (max-width: 600px) { .ch-daily { grid-template-columns: minmax(0, 1fr); } .ch-day small { display: none; } }
.ch-kids { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
@media (max-width: 600px) { .ch-kids { grid-template-columns: minmax(0, 1fr); } }
.ch-kid { background: var(--surface); --kc-ink: color-mix(in srgb, var(--kc) 50%, var(--fg)); --kc-tint: color-mix(in srgb, var(--kc) 20%, var(--surface));
  border-top: 6px solid var(--kc); display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.ch-kid h3 { margin: 0; font: 700 1.6rem var(--display); color: var(--kc-ink); display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ch-kid h3 span { font: 600 .8rem var(--body); color: var(--muted); }
.ch-kid.alldone h3 span { color: var(--accent); }
.ch-task { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 10px; border-radius: 12px; background: var(--kc-tint); min-height: 56px; }
.ch-task input { appearance: none; -webkit-appearance: none; width: 26px; height: 26px; margin: 1px 0 0; border: 2.5px solid var(--kc); border-radius: 8px; background: var(--bg); display: grid; place-content: center; cursor: pointer; }
.ch-task input::after { content: ""; width: 7px; height: 13px; border: solid var(--bg); border-width: 0 3px 3px 0; transform: rotate(45deg) translate(-1px,-1px); opacity: 0; }
.ch-task input:checked { background: var(--kc); }
.ch-task input:checked::after { opacity: 1; }
.ch-task label { cursor: pointer; min-width: 0; }
.ch-task .tag { font: 700 .68rem var(--body); letter-spacing: .07em; text-transform: uppercase; color: var(--kc-ink); }
.ch-task .txt { font-weight: 600; font-size: 1.02rem; overflow-wrap: anywhere; }
.ch-task.done .txt { text-decoration: line-through; opacity: .55; }
.ch-task.none { background: transparent; border: 1px dashed var(--line); }
.ch-task.none .txt { color: var(--muted); font-weight: 500; }
.ch-swapbtn { min-height: 40px; padding: 0 14px; border-radius: 20px; border: 1.5px solid var(--kc); color: var(--kc-ink); background: var(--bg); font-weight: 700; font-size: .8rem; }
.ch-swapbtn[aria-expanded="true"] { background: var(--kc); color: var(--bg); }
.ch-swapmenu { border: 1.5px solid var(--kc); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
.ch-lab { font-size: .8rem; font-weight: 700; color: var(--muted); }
.ch-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ch-kidbtn, .ch-scope { min-height: 40px; padding: 0 14px; border-radius: 20px; font-weight: 700; }
.ch-kidbtn { border-color: var(--kc); color: var(--kc-ink); }
.ch-kidbtn:disabled { opacity: .45; cursor: default; }
.ch-scope[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.ch-tablewrap { overflow-x: auto; margin-top: 8px; }
.ch table { border-collapse: collapse; width: 100%; min-width: 520px; }
.ch th, .ch td { padding: 10px 12px; text-align: left; vertical-align: top; border-top: 1px solid var(--line); font-size: .9rem; }
.ch td div + div { margin-top: 4px; }
.ch thead th { border-top: none; font: 600 .8rem var(--body); }
.ch tbody th { color: var(--muted); font-weight: 600; white-space: nowrap; }
.ch-foot { font-size: .8rem; color: var(--muted); margin: 8px 0 0; }
.ch-det > summary { min-height: 44px; display: flex; align-items: center; font-weight: 600; cursor: pointer; }
.ch-ed { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 8px; }
.ch-ed input[type="text"], .ch-ed input[type="date"], .ch-ed select { font: 500 .9rem var(--body); min-height: 40px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); width: 100%; }
.ch-ed .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.ch-ed .slot { display: flex; flex-direction: column; gap: 3px; font-size: .75rem; color: var(--muted); }
.ch-ed p { margin: 0; font-size: .8rem; color: var(--muted); }
.ch-ed .title { font-weight: 600; }
.ch-list { display: flex; flex-direction: column; gap: 8px; }
.ch-edit { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ch-edit input[type="text"] { flex: 1 1 220px; width: auto; }
.ch-edit select { flex: 0 1 230px; width: auto; }
.ch-x { min-width: 44px; padding: 0; font-size: 1.3rem; line-height: 1; border-radius: 22px; min-height: 44px; }
.ch-wxtab { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 20; writing-mode: vertical-rl; min-height: 96px; padding: 14px 8px; border-radius: 14px 0 0 14px; border-right: none; background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 700; letter-spacing: .08em; }
.ch-back { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,.4); }
.ch-back[hidden] { display: none; }
.ch-wxpanel { position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 92vw); z-index: 40; background: var(--surface); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0,0,0,.3); transform: translateX(100%); transition: transform .25s ease; padding: max(18px, env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom)); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.ch-wxpanel.open { transform: none; }
@media (prefers-reduced-motion: reduce) { .ch-wxpanel { transition: none; } }
.ch-wxhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.ch-wxhead h2 { margin: 0; font: 600 1.25rem var(--display); }
.ch-wxclose { min-width: 44px; min-height: 44px; border-radius: 22px; font-size: 1.5rem; line-height: 1; padding: 0; }
.ch-wxtemp { font: 600 4.2rem/1 var(--display); }
.ch-wxsky { font-size: 1rem; color: var(--muted); font-weight: 600; }
.ch-wxrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.ch-wxstat { background: var(--bg); border-radius: 12px; padding: 10px; }
.ch-wxstat b { display: block; font: 600 1.4rem var(--display); }
.ch-wxstat span { font: 600 .7rem var(--body); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.ch-wxwear { border-left: 5px solid var(--accent); background: var(--bg); border-radius: 12px; padding: 12px 14px; }
.ch-wxwear b { font: 600 1.05rem var(--display); }
.ch-wxwear ul { margin: 6px 0 0; padding-left: 18px; }
.ch-wxwear li { margin: 3px 0; }
`;
    document.head.append(s);
  }

  function build() {
    addStyles();
    root().append(
      h("div", { class: "ch" },
        h("section", { class: "panel" },
          h("div", { class: "ch-head" },
            h("div", null, h("h2", { class: "label" }, "Chores"), h("div", { class: "ch-sub", id: "chSub" })),
            h("div", { class: "ch-nav" },
              h("button", { class: "ch-btn", id: "chPrev", type: "button", "aria-label": "Previous week" }, "← Week"),
              h("div", { class: "ch-week", id: "chWeek", "aria-live": "polite" }),
              h("button", { class: "ch-btn", id: "chNext", type: "button", "aria-label": "Next week" }, "Week →"),
              h("button", { class: "ch-btn pri", id: "chToday", type: "button" }, "Today"),
              h("button", { class: "ch-btn", id: "chLook", type: "button" }, "Look")))),
        h("section", { class: "panel ch-daily", id: "chDaily", "aria-label": "Joke and fun fact of the day" }),
        h("div", { class: "ch-days", id: "chDays", role: "group", "aria-label": "Day of the week" }),
        h("div", { class: "ch-kids", id: "chKids" }),
        h("section", { class: "panel" },
          h("h2", { class: "label" }, "Who has what this week"),
          h("div", { class: "ch-tablewrap" }, h("table", { id: "chMatrix" })),
          h("p", { class: "ch-foot", id: "chMatrixNote" })),
        h("details", { class: "panel ch-det", id: "chEditor" }, h("summary", null, "Edit kids, chores and rotation"), h("div", { class: "ch-ed", id: "chEd" })),
        h("p", { class: "ch-foot" }, "Chores are saved on this device only. On an iPad, set them up from the Home Screen icon, since Safari and the icon keep separate storage.")),
      h("button", { class: "ch-wxtab", id: "chWxTab", type: "button", "aria-expanded": "false", "aria-controls": "chWxPanel" }, "Weather"),
      h("div", { class: "ch-back", id: "chBack", hidden: true }),
      h("aside", { class: "ch-wxpanel", id: "chWxPanel", "aria-label": "Weather", "aria-hidden": "true", inert: true },
        h("div", { class: "ch-wxhead", }, h("h2", { id: "chWxTitle" }, "Weather"), h("button", { class: "ch-wxclose", id: "chWxClose", type: "button", "aria-label": "Close weather" }, "×")),
        h("div", { id: "chWxBody" }),
        h("button", { class: "ch-btn", id: "chWxFull", type: "button" }, "See the full forecast")));
    q("chPrev").onclick = () => { view = addDays(view, -7); followToday = false; renderBoard(); };
    q("chNext").onclick = () => { view = addDays(view, 7); followToday = false; renderBoard(); };
    q("chToday").onclick = () => { view = noon(new Date()); followToday = true; renderBoard(); };
    q("chLook").onclick = () => { const b = document.getElementById("lookBtn"); if (b) b.click(); };
    q("chWxTab").onclick = () => wxToggle(!drawerOpen);
    q("chWxClose").onclick = () => wxToggle(false);
    q("chBack").onclick = () => wxToggle(false);
    q("chWxFull").onclick = () => { wxToggle(false); const b = document.querySelector('#tabs [data-tab="weather"]'); if (b) b.click(); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOpen) wxToggle(false); });
    built = true;
  }

  // ---------- joke and fun fact ----------
  function renderDaily() {
    const day = dayNum(new Date(Date.now() - 6 * 36e5));      // the pair changes at 6 AM
    const [setup, punch] = JOKES[day % JOKES.length], fact = FACTS[(day + 17) % FACTS.length];
    const pk = day + "|" + setup, open = punchOpen === pk;
    const box = q("chDaily");
    box.replaceChildren(
      h("div", null, h("h2", { class: "label" }, "Joke of the day"), h("p", null, setup),
        open ? h("p", { class: "pl" }, punch) : h("button", { type: "button", onclick: () => { punchOpen = pk; renderDaily(); } }, "Show the punchline")),
      h("div", null, h("h2", { class: "label" }, "Fun fact"), h("p", null, fact)));
  }

  // ---------- swap ----------
  function setOverride(key, kid) {
    if (kid === null) delete ovr[key]; else ovr[key] = kid;
    save(); renderBoard();
  }
  function toggleSwap(list, id) {
    swap = (swap && swap.list === list && swap.id === id) ? null : { list, id, scope: null };
    renderBoard();
  }
  function swapMenu(list, c, cur) {
    const scopes = list === "daily" ? [["d", "Just today"], ["w", "All week"]] : list === "weekly" ? [["w", "This week"]] : [["m", "This month"]];
    if (!scopes.some((s) => s[0] === swap.scope)) swap.scope = scopes[0][0];
    const applied = appliedKeys(list, c.id, view).filter((k) => okKid(ovr[k]));
    return h("div", { class: "ch-swapmenu" },
      h("div", { class: "ch-lab" }, "Give “" + c.t + "” to"),
      h("div", { class: "ch-row" }, cfg.kids.map((nm, k) => h("button", { class: "ch-kidbtn", type: "button", style: "--kc:" + KID_COLORS[k % 8] + ";--kc-ink:color-mix(in srgb," + KID_COLORS[k % 8] + " 50%,var(--fg))",
        "aria-pressed": k === cur ? "true" : "false", disabled: k === cur,
        onclick: () => { const key = scopeKey(list, swap.scope, c.id, view); swap = null; setOverride(key, k); } }, nm))),
      scopes.length > 1
        ? h("div", { class: "ch-row" }, h("span", { class: "ch-lab" }, "For"), scopes.map(([s, l]) => h("button", { class: "ch-scope", type: "button", "aria-pressed": swap.scope === s ? "true" : "false", onclick: () => { swap.scope = s; renderBoard(); } }, l)))
        : h("div", { class: "ch-lab" }, "For " + scopes[0][1].toLowerCase()),
      h("div", { class: "ch-row" },
        applied.length ? h("button", { class: "ch-scope", type: "button", onclick: () => { swap = null; applied.forEach((k) => { delete ovr[k]; }); save(); renderBoard(); } }, "Back to normal") : null,
        h("button", { class: "ch-scope", type: "button", onclick: () => { swap = null; renderBoard(); } }, "Cancel")));
  }
  function taskRow(t, k) {
    const on = !!checks[t.key], id = "chk-" + t.key.replace(/[^\w-]/g, "_");
    const swapped = appliedKeys(t.list, t.c.id, view).some((x) => okKid(ovr[x]));
    const open = !!(swap && swap.list === t.list && swap.id === t.c.id);
    const row = h("div", { class: "ch-task" + (on ? " done" : "") },
      h("input", { type: "checkbox", id, checked: on, onchange: (e) => { if (e.target.checked) checks[t.key] = true; else delete checks[t.key]; save(); renderBoard(); } }),
      h("label", { for: id }, h("div", { class: "tag" }, t.tag + (swapped ? " · swapped" : "")), h("div", { class: "txt" }, t.c.t)),
      h("button", { class: "ch-swapbtn", type: "button", "aria-expanded": open ? "true" : "false", "aria-label": "Reassign " + t.c.t, onclick: () => toggleSwap(t.list, t.c.id) }, "Swap"));
    return open ? [row, swapMenu(t.list, t.c, k)] : [row];
  }

  // ---------- board ----------
  function renderBoard() {
    const mon = monday(view), today = new Date(), sun = addDays(mon, 6), vk = ymd(view);
    q("chWeek").textContent = MON[mon.getMonth()] + " " + mon.getDate() + " – " + (sun.getMonth() !== mon.getMonth() ? MON[sun.getMonth()] + " " : "") + sun.getDate();
    q("chSub").textContent = ymd(today) === vk ? "Today is " + DOW[mod(today.getDay() + 6, 7)] + ", " + MON[today.getMonth()] + " " + today.getDate()
      : DOW[mod(view.getDay() + 6, 7)] + ", " + MON[view.getMonth()] + " " + view.getDate();
    q("chDays").replaceChildren(...DOW.map((nm, i) => {
      const d = addDays(mon, i);
      return h("button", { class: "ch-day" + (ymd(d) === ymd(today) ? " today" : ""), type: "button", "aria-pressed": ymd(d) === vk ? "true" : "false",
        onclick: () => { view = d; followToday = ymd(d) === ymd(new Date()); renderBoard(); } }, nm, h("small", null, MON[d.getMonth()] + " " + d.getDate()));
    }));
    q("chKids").replaceChildren(...cfg.kids.map((name, k) => {
      const tasks = tasksFor(k, view), done = tasks.filter((x) => checks[x.key]).length;
      return h("section", { class: "panel ch-kid" + (tasks.length && done === tasks.length ? " alldone" : ""), style: "--kc:" + KID_COLORS[k % 8] },
        h("h3", null, name, h("span", null, tasks.length ? (done === tasks.length ? "All done" : done + " of " + tasks.length) : "Nothing assigned")),
        tasks.length ? tasks.flatMap((x) => taskRow(x, k)) : h("div", { class: "ch-task none" }, h("span"), h("div", null, h("div", { class: "txt" }, "Nothing assigned"))));
    }));
    const rows = [["Daily", "daily"], ["Weekly", "weekly"], ["Monthly · " + MONTHS[view.getMonth()], "monthly"]];
    q("chMatrix").replaceChildren(
      h("thead", null, h("tr", null, h("th"), cfg.kids.map((nm, k) => h("th", { style: "color:color-mix(in srgb," + KID_COLORS[k % 8] + " 50%,var(--fg))" }, nm)))),
      h("tbody", null, rows.map(([lbl, list]) => h("tr", null, h("th", { scope: "row" }, lbl),
        cfg.kids.map((_, k) => {
          const names = cfg[list].filter((c, pos) => c.t && holderOn(list, pos, view, true) === k).map((c) => c.t);
          return h("td", null, names.length ? names.map((x) => h("div", null, x)) : h("span", { class: "ch-sub" }, "—"));
        })))));
    q("chMatrixNote").textContent = "Each week the rotating daily and weekly chores move one kid to the right (the last kid wraps back to the first). Monthly chores move one kid to the right each month. Chores set to Always stay put. Swaps count for a week or a month here, not for a single day.";
    if (drawerOpen) renderWeather();
  }

  // ---------- editor ----------
  function choreEditRow(l, c, pos, title) {
    const sel = h("select", { "aria-label": "Who does " + (c.t || "this chore"), onchange: (e) => { c.pin = e.target.value === "" ? null : Number(e.target.value); save(); renderBoard(); renderEditor(); } },
      h("option", { value: "" }, "Rotates · starts with " + cfg.kids[rotRank(l, pos) % n()]), cfg.kids.map((nm, k) => h("option", { value: String(k) }, "Always " + nm)));
    sel.value = okKid(c.pin) ? String(c.pin) : "";
    return h("div", { class: "ch-edit" },
      h("input", { type: "text", value: c.t, maxlength: "80", placeholder: "Describe the chore", "aria-label": title + " " + (pos + 1), "data-id": c.id,
        onchange: (e) => { c.t = e.target.value.trim(); save(); renderBoard(); renderEditor(); } }),
      sel,
      h("button", { class: "ch-x", type: "button", "aria-label": "Remove " + (c.t || "this chore"), onclick: () => { cfg[l].splice(pos, 1); save(); renderBoard(); renderEditor(); } }, "×"));
  }
  function renderEditor() {
    const ed = q("chEd"), N = n();
    const kidsRow = h("div", null, h("div", { class: "title ch-sub", style: "margin-bottom:6px" }, "Kids, in the order the chores move (left to right)"),
      h("div", { class: "grid" }, cfg.kids.map((nm, k) => h("label", { class: "slot" }, "Kid " + (k + 1),
        h("input", { type: "text", value: nm, maxlength: "24", onchange: (e) => { cfg.kids[k] = e.target.value.trim() || "Kid " + (k + 1); save(); renderBoard(); renderEditor(); } })))),
      h("div", { class: "ch-row", style: "margin-top:8px" },
        h("button", { class: "ch-btn", type: "button", disabled: N >= 8, onclick: () => { cfg.kids.push("Kid " + (N + 1)); save(); renderBoard(); renderEditor(); } }, "Add a kid"),
        h("button", { class: "ch-btn", type: "button", disabled: N <= 2, onclick: () => { cfg.kids.pop(); save(); renderBoard(); renderEditor(); } }, "Remove last kid")));
    const lists = LISTS.map(([l, title, help]) =>
      h("div", null, h("div", { class: "title ch-sub", style: "margin-bottom:2px" }, title),
        h("p", { style: "margin-bottom:6px" }, help + " A rotating chore moves one kid to the right each " + (l === "monthly" ? "month" : "week") + ". Pick “Always” to keep a chore with one kid."),
        h("div", { class: "ch-list" }, cfg[l].map((c, pos) => choreEditRow(l, c, pos, title.replace(/s$/, "")))),
        h("div", { class: "ch-row", style: "margin-top:8px" },
          h("button", { class: "ch-btn", type: "button", onclick: () => { const id = newId(); cfg[l].push({ id, t: "", pin: null }); lastAdded = id; save(); renderBoard(); renderEditor(); } }, "Add a " + l + " chore"))));
    const anchor = h("div", null,
      h("label", { class: "slot" }, "Rotation start: the week when each rotating chore sits with the kid named beside it",
        h("input", { type: "date", value: ymd(monday(parse(cfg.anchor))), onchange: (e) => { if (e.target.value) { cfg.anchor = ymd(monday(parse(e.target.value))); save(); renderBoard(); renderEditor(); } } })),
      h("p", { style: "margin-top:6px" }, "Pick any day; it snaps to that week's Monday. Change it to line the rotation up with who really has which chore now."));
    ed.replaceChildren(kidsRow, ...lists, anchor);
    if (lastAdded) { const el = ed.querySelector('input[data-id="' + lastAdded + '"]'); if (el) el.focus(); lastAdded = null; }
  }

  // ---------- weather drawer: what to wear, from the live forecast ----------
  function wearAdvice(loF, hiF, pop) {
    const out = [];
    if (loF != null) {
      if (loF <= 40) out.push("A warm coat, hat and gloves for the morning.");
      else if (loF <= 55) out.push("A jacket or hoodie for the morning.");
      else if (loF <= 65) out.push("A long-sleeve shirt or light sweater.");
      else out.push("Short sleeves are fine.");
    }
    if (loF != null && hiF != null && hiF - loF >= 15 && loF <= 65) out.push("Wear layers: it warms up about " + Math.round(hiF - loF) + " degrees by afternoon.");
    if (hiF != null && hiF >= 80) out.push("Pack a water bottle and sunscreen.");
    if (pop >= 40) out.push("Bring a rain jacket or umbrella.");
    else if (pop >= 20) out.push("Maybe pack a small umbrella.");
    return out;
  }
  function renderWeather() {
    const body = q("chWxBody"), key = ymd(view), isToday = key === ymd(new Date());
    const place = (document.getElementById("place") || {}).textContent || "";
    q("chWxTitle").textContent = (place ? place + " · " : "") + (isToday ? "Today" : DOW[mod(view.getDay() + 6, 7)] + ", " + MON[view.getMonth()] + " " + view.getDate());
    const d = typeof lastData !== "undefined" ? lastData : null;
    if (!d) { body.replaceChildren(h("p", { class: "ch-sub" }, "Loading the forecast. If this stays empty, open the Weather tab and allow your location.")); return; }
    const day = (d.days || []).find((x) => x.key === key);
    if (!day) { body.replaceChildren(h("p", { class: "ch-sub" }, "The forecast only covers the next seven days.")); return; }
    const c = d.current || {}, pop = day.pop || 0;
    const big = isToday && c.tempC != null ? c.tempC : day.hiC;
    const sky = isToday ? c.desc : day.desc;
    const feels = isToday && c.feelsC != null && Math.round(c.feelsC) !== Math.round(c.tempC) ? " · feels like " + t(c.feelsC) : "";
    const stat = (v, l) => h("div", { class: "ch-wxstat" }, h("b", null, v), h("span", null, l));
    const tips = wearAdvice(day.loC != null ? cToF(day.loC) : null, day.hiC != null ? cToF(day.hiC) : null, pop);
    body.replaceChildren(
      h("div", null, h("div", { class: "ch-wxtemp" }, t(big)), h("div", { class: "ch-wxsky" }, (isToday ? "Right now" : "High") + (sky ? " · " + sky : "") + feels)),
      h("div", { class: "ch-wxrow" }, (day.hiC != null ? stat(t(day.hiC), "High") : stat(c.feelsC != null ? t(c.feelsC) : "\u2013", "Feels like")), stat(t(day.loC), "Low"), stat(pop + "%", "Rain")),
      h("div", { class: "ch-wxwear" }, h("b", null, "What to wear"), h("ul", null, tips.length ? tips.map((x) => h("li", null, x)) : h("li", null, "No forecast numbers yet."))),
      h("p", { class: "ch-sub" }, "Updated " + (d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now") + (d.source ? " · " + d.source : "") + "."));
  }
  function wxToggle(open) {
    drawerOpen = open;
    const p = q("chWxPanel");
    p.classList.toggle("open", open); p.inert = !open; p.setAttribute("aria-hidden", open ? "false" : "true");
    q("chBack").hidden = !open; q("chWxTab").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { renderWeather(); q("chWxClose").focus(); } else q("chWxTab").focus();
  }

  // ---------- hooks used by index.html ----------
  function renderAll() { renderDaily(); renderBoard(); renderEditor(); }
  window.showChores = () => {
    if (!built) build();
    if (followToday) view = noon(new Date());
    renderAll();
  };
  window.refreshChoresWeather = () => { if (built && drawerOpen) renderWeather(); };
  if (typeof currentTab === "function" && currentTab() === "chores") setTab("chores", false);
})();
