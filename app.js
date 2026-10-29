// Santa Monica coordinates (6th & Wilshire area)
const LAT = 34.0259;
const LON = -118.4930;
// All times are shown and reasoned about in Santa Monica time, whatever the
// device's own time zone is
const TIME_ZONE = "America/Los_Angeles";

// Temperature unit: "C" or "F" — default Celsius
let tempUnit = localStorage.getItem("tempUnit") || "C";

function toF(c) { return c * 9 / 5 + 32; }
function toC(f) { return (f - 32) * 5 / 9; }
// Display temp in chosen unit (input is always Fahrenheit from internal calculations)
function displayTemp(f) {
  if (tempUnit === "C") return `${Math.round(toC(f))}\u00B0C`;
  return `${Math.round(f)}\u00B0F`;
}
function displayTempValue(f) {
  return tempUnit === "C" ? Math.round(toC(f)) : Math.round(f);
}
function unitLabel() { return tempUnit === "C" ? "\u00B0C" : "\u00B0F"; }
// Convert user input (in current display unit) to Fahrenheit for internal use
function inputToF(val) { return tempUnit === "C" ? toF(val) : val; }

// Configurable rating thresholds (stored in Fahrenheit internally)
const DEFAULT_THRESHOLDS = {
  backyardGreat: 72,
  backyardGood: 65,
  palisadesGreat: 68,
  palisadesGood: 60,
  walkGreat: 62,
  sunsetGreat: 58,
  walkWindMax: 15,
};

function loadThresholds() {
  const saved = localStorage.getItem("thresholds");
  if (saved) {
    try { return { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) }; } catch (e) {}
  }
  return { ...DEFAULT_THRESHOLDS };
}

function saveThresholds(t) {
  localStorage.setItem("thresholds", JSON.stringify(t));
}

let thresholds = loadThresholds();

// Backyard geometry — typical Santa Monica courtyard
// Santa Monica's street grid (and so every lot line on it) is rotated ~40° from
// true north: "north" on the grid, toward Montana Ave, is really northwest.
// The yard is modeled in grid directions and the sun is rotated into that frame.
const YARD_BEARING = 320; // compass bearing (degrees) of the yard's grid-north axis
const YARD_WIDTH = 30; // feet, west wall to east wall
const YARD_DEPTH = 30; // feet, south wall to north wall
// feet, two-story buildings on all sides
const WALL_HEIGHTS = { north: 25, south: 25, east: 25, west: 25 };
const SUN_THRESHOLD = 0.25; // need 25% of yard sunlit
const CLOUD_COVER_MAX = 80; // % cloud cover above which the sun is blocked
const SHADOW_GRID = 20; // sample points per axis for shadow calculation

// Solar position calculator using NOAA's general solar position equations
// (Spencer 1971 Fourier series for declination and equation of time)
function solarPosition(date) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // Fractional year (radians), including the time of day
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const g = ((2 * Math.PI) / 365) * ((date - yearStart) / 86400000 - 0.5);

  // Equation of time (minutes)
  const EoT = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
    0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));

  // Solar declination (radians)
  const declRad = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  // Solar time
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTime = utcHours + LON / 15 + EoT / 60; // hours
  // Wrap to [-180°, 180°): from late afternoon on, the UTC clock has already
  // rolled over to the next day, which would otherwise read as morning
  const hourAngle = ((((solarTime - 12) * 15) % 360) + 540) % 360 - 180; // degrees

  const latRad = LAT * rad;
  const haRad = hourAngle * rad;

  // Solar elevation
  const sinElev =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const elevation = Math.asin(sinElev) * deg;

  // Solar azimuth (0° = North, clockwise)
  const cosAz =
    (Math.sin(declRad) - Math.sin(latRad) * sinElev) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinElev)));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
  if (hourAngle > 0) azimuth = 360 - azimuth; // afternoon: azimuth > 180°

  return { elevation, azimuth };
}

// Check if a single point in the yard receives direct sun
// Yard coordinate system (grid directions): x=0 is west wall, x=YARD_WIDTH is
// east wall, y=0 is south wall, y=YARD_DEPTH is north wall.
// yardAzimuth is the sun's azimuth relative to the yard's north axis.
function isPointSunlit(x, y, elevation, yardAzimuth) {
  const rad = Math.PI / 180;
  const tanElev = Math.tan(elevation * rad);
  const sinAz = Math.sin(yardAzimuth * rad);
  const cosAz = Math.cos(yardAzimuth * rad);

  // Ray from (x, y, 0) toward sun direction (sinAz, cosAz, tanElev)
  // Check if ray intersects any wall below the wall's height

  // South wall (y=0): blocks when sun is south (cosAz < 0)
  if (cosAz < 0) {
    const t = -y / cosAz;
    const xHit = x + t * sinAz;
    const zHit = t * tanElev;
    if (xHit >= 0 && xHit <= YARD_WIDTH && zHit <= WALL_HEIGHTS.south) return false;
  }

  // North wall (y=YARD_DEPTH): blocks when sun is north (cosAz > 0)
  if (cosAz > 0) {
    const t = (YARD_DEPTH - y) / cosAz;
    const xHit = x + t * sinAz;
    const zHit = t * tanElev;
    if (xHit >= 0 && xHit <= YARD_WIDTH && zHit <= WALL_HEIGHTS.north) return false;
  }

  // East wall (x=YARD_WIDTH): blocks when sun is east (sinAz > 0)
  if (sinAz > 0) {
    const t = (YARD_WIDTH - x) / sinAz;
    const yHit = y + t * cosAz;
    const zHit = t * tanElev;
    if (yHit >= 0 && yHit <= YARD_DEPTH && zHit <= WALL_HEIGHTS.east) return false;
  }

  // West wall (x=0): blocks when sun is west (sinAz < 0)
  if (sinAz < 0) {
    const t = -x / sinAz;
    const yHit = y + t * cosAz;
    const zHit = t * tanElev;
    if (yHit >= 0 && yHit <= YARD_DEPTH && zHit <= WALL_HEIGHTS.west) return false;
  }

  return true;
}

// Calculate fraction of backyard receiving direct sun at a given moment
function backyardSunFraction(date) {
  const { elevation, azimuth } = solarPosition(date);
  if (elevation <= 0) return { fraction: 0, elevation, azimuth };

  const yardAzimuth = azimuth - YARD_BEARING;
  let sunlit = 0;
  const total = SHADOW_GRID * SHADOW_GRID;
  const xStep = YARD_WIDTH / SHADOW_GRID;
  const yStep = YARD_DEPTH / SHADOW_GRID;

  for (let i = 0; i < SHADOW_GRID; i++) {
    for (let j = 0; j < SHADOW_GRID; j++) {
      const x = (i + 0.5) * xStep;
      const y = (j + 0.5) * yStep;
      if (isPointSunlit(x, y, elevation, yardAzimuth)) sunlit++;
    }
  }

  return { fraction: sunlit / total, elevation, azimuth };
}

// Fraction of the yard lit every 10 minutes from sunrise to sunset
// Memoized per day: this is the expensive part and only depends on the date
let sunSamplesCache = { key: null, samples: null };
function daySunSamples(sunrise, sunset) {
  if (sunSamplesCache.key === sunrise.getTime()) return sunSamplesCache.samples;
  const STEP_MS = 10 * 60 * 1000;
  const samples = [];
  for (let t = Math.ceil(sunrise.getTime() / STEP_MS) * STEP_MS; t <= sunset.getTime(); t += STEP_MS) {
    const time = new Date(t);
    samples.push({ time, fraction: backyardSunFraction(time).fraction });
  }
  sunSamplesCache = { key: sunrise.getTime(), samples };
  return samples;
}

// Direct sun needs a clear or partly cloudy sky: overcast, the marine layer,
// fog and rain all block it
function isSkyClear(code, cloudCover) {
  return code <= 2 && cloudCover < CLOUD_COVER_MAX;
}

// Find the day's sun windows where >= 25% of the yard is lit and, per the
// hourly forecast passed as isSkyClearAt(time), the sky is clear
// Returns array of { start, end, peakFraction, peakTime }
function findSunWindows(sunrise, sunset, isSkyClearAt = () => true) {
  const windows = [];
  let currentWindow = null;

  for (const { time, fraction } of daySunSamples(sunrise, sunset)) {
    if (fraction >= SUN_THRESHOLD && isSkyClearAt(time)) {
      if (!currentWindow) {
        currentWindow = { start: time, end: time, peakFraction: fraction, peakTime: time };
      } else {
        currentWindow.end = time;
        if (fraction > currentWindow.peakFraction) {
          currentWindow.peakFraction = fraction;
          currentWindow.peakTime = time;
        }
      }
    } else if (currentWindow) {
      windows.push(currentWindow);
      currentWindow = null;
    }
  }
  if (currentWindow) windows.push(currentWindow);

  return windows;
}

// Weather code descriptions and icons
const WMO_CODES = {
  0: { desc: "Clear sky", icon: "\u2600\uFE0F" },
  1: { desc: "Mainly clear", icon: "\uD83C\uDF24\uFE0F" },
  2: { desc: "Partly cloudy", icon: "\u26C5" },
  3: { desc: "Overcast", icon: "\u2601\uFE0F" },
  45: { desc: "Foggy", icon: "\uD83C\uDF2B\uFE0F" },
  48: { desc: "Depositing rime fog", icon: "\uD83C\uDF2B\uFE0F" },
  51: { desc: "Light drizzle", icon: "\uD83C\uDF26\uFE0F" },
  53: { desc: "Moderate drizzle", icon: "\uD83C\uDF26\uFE0F" },
  55: { desc: "Dense drizzle", icon: "\uD83C\uDF27\uFE0F" },
  61: { desc: "Slight rain", icon: "\uD83C\uDF27\uFE0F" },
  63: { desc: "Moderate rain", icon: "\uD83C\uDF27\uFE0F" },
  65: { desc: "Heavy rain", icon: "\uD83C\uDF27\uFE0F" },
  80: { desc: "Slight showers", icon: "\uD83C\uDF26\uFE0F" },
  81: { desc: "Moderate showers", icon: "\uD83C\uDF27\uFE0F" },
  82: { desc: "Violent showers", icon: "\u26C8\uFE0F" },
};

function getWeatherInfo(code) {
  return WMO_CODES[code] || { desc: "Unknown", icon: "\u2753" };
}

// Fetch real tide predictions from NOAA Tides & Currents API
// Station 9410840 = Santa Monica, CA
async function fetchTides(now) {
  const NOAA_STATION = "9410840";
  // Times come back in GMT; three GMT days fully cover today and tomorrow here
  const today = localDateKey(now);

  const params = new URLSearchParams({
    begin_date: today,
    end_date: shiftDateKey(today, 2),
    station: NOAA_STATION,
    product: "predictions",
    datum: "MLLW",
    units: "english",
    time_zone: "gmt",
    format: "json",
    interval: "hilo",
  });

  const resp = await fetch(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`
  );
  if (!resp.ok) throw new Error(`NOAA tide API error: ${resp.status}`);
  const json = await resp.json();

  if (json.error) {
    throw new Error(`NOAA tide API: ${json.error.message || JSON.stringify(json.error)}`);
  }

  if (!json.predictions || json.predictions.length === 0) {
    return { tides: [], isSpringTide: false };
  }

  const tides = json.predictions.map((p) => ({
    time: new Date(`${p.t.replace(" ", "T")}Z`),
    type: p.type === "H" ? "High" : "Low",
    height: parseFloat(p.v).toFixed(1),
  }));

  // Determine spring tide: if any high tide >= 5.0 ft, it's likely a spring tide
  const isSpringTide = tides.some(
    (t) => t.type === "High" && parseFloat(t.height) >= 5.0
  );

  return { tides, isSpringTide };
}

// Continuous tide height at any moment (cosine interpolation between high/low events)
function tideHeightAt(time, tideData) {
  const t = time.getTime();
  const events = tideData.tides;
  if (events.length < 2) return null;

  // Find surrounding tide events
  for (let i = 0; i < events.length - 1; i++) {
    const t0 = events[i].time.getTime();
    const t1 = events[i + 1].time.getTime();
    if (t >= t0 && t <= t1) {
      const h0 = parseFloat(events[i].height);
      const h1 = parseFloat(events[i + 1].height);
      const frac = (t - t0) / (t1 - t0);
      return h0 + (h1 - h0) * (0.5 - 0.5 * Math.cos(Math.PI * frac));
    }
  }

  // Before first event: extrapolate from first two
  if (t < events[0].time.getTime()) {
    const h0 = parseFloat(events[0].height);
    const h1 = parseFloat(events[1].height);
    const t0 = events[0].time.getTime();
    const t1 = events[1].time.getTime();
    const frac = 1 - (t0 - t) / (t1 - t0);
    if (frac >= 0) return h1 + (h0 - h1) * (0.5 - 0.5 * Math.cos(Math.PI * frac));
  }

  // Outside the predictions we have: unknown rather than a made-up flat line
  return null;
}

// Civil twilight: until the sun is 6° below the horizon (roughly 25–30 min
// before sunrise and after sunset here) there's plenty of light to run by
const CIVIL_TWILIGHT_ELEVATION = -6; // degrees

// First and last running light (civil dawn and dusk) around a sunrise/sunset
function civilTwilight(sunrise, sunset) {
  const STEP_MS = 60 * 1000;
  const isLight = (t) => solarPosition(new Date(t)).elevation >= CIVIL_TWILIGHT_ELEVATION;
  let dawn = sunrise.getTime();
  while (isLight(dawn - STEP_MS)) dawn -= STEP_MS;
  let dusk = sunset.getTime();
  while (isLight(dusk + STEP_MS)) dusk += STEP_MS;
  return { dawn: new Date(dawn), dusk: new Date(dusk) };
}

// Find joggable beach windows: enough light (dawn to dusk) AND tide < 2 ft
function findJoggableWindows(dawn, dusk, tideData) {
  const dawnTime = dawn.getTime();
  const duskTime = dusk.getTime();
  const windows = [];
  let currentWindow = null;
  const STEP_MS = 10 * 60 * 1000; // 10-minute steps
  const MAX_TIDE = 2.0; // feet

  for (let t = dawnTime; t <= duskTime; t += STEP_MS) {
    const time = new Date(t);
    const height = tideHeightAt(time, tideData);
    const isJoggable = height !== null && height < MAX_TIDE;

    if (isJoggable) {
      if (!currentWindow) {
        currentWindow = { start: time, end: time, minTide: height };
      } else {
        currentWindow.end = time;
        if (height < currentWindow.minTide) currentWindow.minTide = height;
      }
    } else if (currentWindow) {
      windows.push(currentWindow);
      currentWindow = null;
    }
  }
  if (currentWindow) windows.push(currentWindow);

  return windows;
}

// Open-Meteo times are Unix seconds
function unixDate(seconds) {
  return new Date(seconds * 1000);
}

// Santa Monica calendar date as "YYYYMMDD"
function localDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}${get("month")}${get("day")}`;
}

// Shift a "YYYYMMDD" date key by whole calendar days (DST-proof)
function shiftDateKey(key, days) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

function formatHour(unixSeconds) {
  return unixDate(unixSeconds).toLocaleTimeString("en-US", {
    hour: "numeric",
    timeZone: TIME_ZONE,
  });
}

function dayName(unixSeconds) {
  // Daily entries are stamped at midnight; midday is unambiguously on that day
  const midday = new Date(unixSeconds * 1000 + 12 * 3600 * 1000);
  const key = localDateKey(midday);
  const today = localDateKey(new Date());
  if (key === today) return "Today";
  if (key === shiftDateKey(today, 1)) return "Tomorrow";
  return midday.toLocaleDateString("en-US", { weekday: "short", timeZone: TIME_ZONE });
}

// Determine if the sun is currently shining on the backyard: shadow geometry
// plus the current sky (skyClearNow) and the hourly forecast (isSkyClearAt)
function backyardSunStatus(now, sunrise, sunset, skyClearNow, isSkyClearAt) {
  const status = {
    hasSun: false,
    fraction: 0,
    cloudy: false, // the yard would be sunny if not for the clouds
    windows: findSunWindows(sunrise, sunset, isSkyClearAt),
    clearSkyWindows: findSunWindows(sunrise, sunset),
  };
  if (now < sunrise) return { ...status, label: "Before sunrise" };
  if (now > sunset) return { ...status, label: "After sunset" };

  const { fraction, elevation } = backyardSunFraction(now);
  const pct = Math.round(fraction * 100);
  status.fraction = fraction;
  status.hasSun = skyClearNow && fraction >= SUN_THRESHOLD;
  status.cloudy = !skyClearNow && fraction >= SUN_THRESHOLD;

  if (fraction < 0.01) {
    status.label = `No \u2014 buildings block sun (elev ${elevation.toFixed(0)}\u00B0)`;
  } else if (!skyClearNow) {
    status.label = `No \u2014 clouds block the sun (${pct}% of yard would be lit)`;
  } else if (fraction < SUN_THRESHOLD) {
    // Keep the label in line with hasSun so it never says "Yes" while the
    // backyard card says there's no sun
    status.label = `Barely \u2014 only ${pct}% of yard in direct sun`;
  } else {
    status.label = `Yes \u2014 ${pct}% of yard in direct sun`;
  }
  return status;
}

// Clothing recommendation based on feels-like temp and wind
function layeringAdvice(feelsLike, wind) {
  if (feelsLike >= 75) return "T-shirt and shorts";
  if (feelsLike >= 68) return wind >= 10 ? "T-shirt, bring a light layer" : "T-shirt is fine";
  if (feelsLike >= 62) return wind >= 12 ? "Light jacket or hoodie" : "Long sleeves or light jacket";
  if (feelsLike >= 55) return wind >= 12 ? "Jacket and long pants" : "Light jacket and long pants";
  if (feelsLike >= 48) return wind >= 10 ? "Warm jacket, beanie helps" : "Warm jacket";
  return wind >= 10 ? "Thick jacket, layers, beanie and gloves" : "Thick jacket and layers";
}

// Rate activities based on current conditions
function rateActivities(weather, tideData, sunStatus, data) {
  const daily = data.daily;
  const feelsLike = weather.feelsLike;
  const wind = weather.wind;
  const gusts = weather.gusts;
  const isRaining = weather.code >= 51;
  const isFoggy = weather.code === 45 || weather.code === 48;
  const uv = weather.uv;
  const now = new Date();

  const activities = [];

  // 1. Backyard hangout
  {
    let rating, reason, tip;
    if (isRaining) {
      rating = "bad";
      reason = "Rain expected \u2014 not great for the backyard.";
      tip = "";
    } else if (!sunStatus.hasSun) {
      const noSun = sunStatus.cloudy ? "Clouds are blocking the sun" : "No direct sun on the backyard";
      const nextSun = sunStatus.windows.find((w) => w.start > now);
      const nextSunStr = nextSun
        ? `Sun reaches the yard ${formatTime(nextSun.start)}\u2013${formatTime(nextSun.end)}.`
        : "";
      if (feelsLike >= 65) {
        rating = "fair";
        reason = `${noSun} right now, but it's warm enough.`;
        tip = `Grab a blanket if you're sitting still. ${nextSunStr}`.trim();
      } else {
        rating = "poor";
        reason = `${noSun}, and it feels like ${displayTemp(feelsLike)} \u2014 it'll feel cold quickly.`;
        tip = nextSun
          ? `${nextSunStr} Wait for it, or head to a sunnier spot.`
          : "No more sun on the yard today \u2014 head to a sunnier spot.";
      }
    } else if (feelsLike >= thresholds.backyardGreat && wind < 10) {
      rating = "great";
      reason = `Direct sun with ${displayTemp(feelsLike)} feels-like temp and light wind.`;
      tip = uv >= 6 ? "UV is high \u2014 wear sunscreen." : "";
    } else if (feelsLike >= thresholds.backyardGood) {
      rating = "good";
      reason = `Sun is hitting the yard. Feels like ${displayTemp(feelsLike)}.`;
      tip = wind >= 10 ? `Wind at ${Math.round(wind)} mph may feel a bit cool in the shade.` : "";
    } else {
      rating = "fair";
      reason = `Sun is out but feels like only ${displayTemp(feelsLike)}.`;
      tip = "Layer up or wait for it to warm.";
    }
    activities.push({
      icon: "\uD83C\uDFE1",
      name: "Backyard Hangout",
      rating,
      reason,
      tip,
    });
  }

  // 2. Palisades picnic / walk
  {
    let rating, reason, tip;
    if (isRaining) {
      rating = "bad";
      reason = "Rain makes the Palisades trails slippery and not enjoyable.";
      tip = "";
    } else if (isFoggy) {
      rating = "poor";
      reason = "Foggy conditions \u2014 limited visibility on the bluffs.";
      tip = "The ocean views will be obscured. Consider a neighborhood walk instead.";
    } else if (feelsLike >= thresholds.palisadesGreat && wind < thresholds.walkWindMax) {
      rating = "great";
      reason = `Beautiful conditions \u2014 ${displayTemp(feelsLike)} with manageable wind.`;
      tip = uv >= 6 ? "Bring sunscreen and a hat for sun exposure on the bluffs." : "Enjoy the views!";
    } else if (feelsLike >= thresholds.palisadesGood && wind < 20) {
      rating = "good";
      reason = `Feels like ${displayTemp(feelsLike)} \u2014 pleasant enough for a walk or picnic.`;
      tip = wind >= 12 ? "It may be breezy on the bluffs. Bring a windbreaker for the picnic." : "";
    } else if (wind >= 20) {
      rating = "poor";
      reason = `Gusts up to ${Math.round(gusts)} mph \u2014 too windy for a comfortable picnic.`;
      tip = "The bluffs are exposed. Consider a more sheltered spot.";
    } else {
      rating = "fair";
      reason = `Feels like ${displayTemp(feelsLike)}. A bit cool for a long picnic.`;
      tip = "A walk would be fine, but bring warm layers for sitting.";
    }
    const palisadesLayer = layeringAdvice(feelsLike, wind);
    if (tip) tip += ` Wear: ${palisadesLayer}.`;
    else tip = `Wear: ${palisadesLayer}.`;
    activities.push({
      icon: "\uD83C\uDF33",
      name: "Palisades Picnic / Walk",
      rating,
      reason,
      tip,
    });
  }

  // 3. Beach run — only while there's light (incl. twilight) with tide < 2 ft
  {
    let rating, reason, tip;
    const light = civilTwilight(unixDate(daily.sunrise[0]), unixDate(daily.sunset[0]));
    const joggableWindows = findJoggableWindows(light.dawn, light.dusk, tideData);
    const currentTide = tideHeightAt(now, tideData);
    const hasLight = now >= light.dawn && now <= light.dusk;
    const tideOk = currentTide !== null && currentTide < 2.0;
    const isJoggableNow = hasLight && tideOk;

    const formatWindows = (windows) => windows.map((w) =>
      `${formatTime(w.start)}\u2013${formatTime(w.end)} (low ${w.minTide.toFixed(1)} ft)`
    ).join(", ");
    const windowStrs = formatWindows(joggableWindows);

    if (now > light.dusk) {
      const tomorrowLight = civilTwilight(unixDate(daily.sunrise[1]), unixDate(daily.sunset[1]));
      const tomorrowWindows = findJoggableWindows(tomorrowLight.dawn, tomorrowLight.dusk, tideData);
      rating = "poor";
      reason = "Too dark to run on the beach right now.";
      tip = tomorrowWindows.length > 0
        ? `Tomorrow\u2019s windows: ${formatWindows(tomorrowWindows)}`
        : "";
    } else if (tideData.tides.length === 0) {
      rating = "fair";
      reason = "Tide data isn't available right now, so there's no telling if the beach is runnable.";
      tip = "You need a tide under 2 ft \u2014 check a tide chart before heading out.";
    } else if (joggableWindows.length === 0) {
      rating = "bad";
      reason = "No joggable windows today \u2014 tide stays above 2 ft while it's light out.";
      tip = "";
    } else if (isJoggableNow) {
      rating = (isRaining || isFoggy) ? "fair" : "great";
      reason = isRaining
        ? `Tide is ${currentTide.toFixed(1)} ft (runnable) but it's raining.`
        : isFoggy
        ? `Tide is ${currentTide.toFixed(1)} ft (runnable) but foggy \u2014 watch for other runners.`
        : `Tide is ${currentTide.toFixed(1)} ft \u2014 go now!`;
      if (now > unixDate(daily.sunset[0])) reason += ` Light lasts until about ${formatTime(light.dusk)}.`;
      tip = `Today\u2019s windows: ${windowStrs}`;
    } else if (!hasLight) {
      rating = "poor";
      reason = `Too dark to run on the beach until about ${formatTime(light.dawn)}.`;
      tip = `Today\u2019s windows: ${windowStrs}`;
    } else {
      // Light out but tide too high
      const nextWindow = joggableWindows.find((w) => w.start > now);
      rating = "poor";
      reason = `Tide is ${currentTide !== null ? currentTide.toFixed(1) : "?"} ft \u2014 too high (need < 2 ft).`;
      tip = nextWindow
        ? `Next window: ${formatTime(nextWindow.start)}\u2013${formatTime(nextWindow.end)}`
        : `Today\u2019s windows: ${windowStrs}`;
    }
    activities.push({
      icon: "\uD83C\uDFC3",
      name: "Beach Run",
      rating,
      reason,
      tip,
      joggableWindows,
    });
  }

  // 4. Neighborhood walk (day / sunset / night)
  {
    let rating, reason, tip;
    const sunrise = unixDate(daily.sunrise[0]);
    const sunset = unixDate(daily.sunset[0]);
    // Sunset walk: from an hour before sunset until an hour after
    const SUNSET_WALK_MS = 60 * 60 * 1000;
    const isSunsetTime = Math.abs(now - sunset) <= SUNSET_WALK_MS;
    const isDaytime = now >= sunrise && now < sunset - SUNSET_WALK_MS;
    const isNight = !isSunsetTime && !isDaytime;

    // Wind is the key discomfort factor for this user
    const windDiscomfort = wind >= thresholds.walkWindMax || (feelsLike < 60 && wind >= 10);

    if (isRaining) {
      rating = "bad";
      reason = "Not a great time for a neighborhood stroll.";
      tip = "";
    } else if (isDaytime && !windDiscomfort && feelsLike >= thresholds.walkGreat) {
      rating = "great";
      reason = `Sunny walk weather \u2014 ${displayTemp(feelsLike)} with gentle breeze.`;
      tip = uv >= 6 ? "Wear a hat \u2014 UV is strong." : "";
    } else if (isSunsetTime && !windDiscomfort && feelsLike >= thresholds.sunsetGreat) {
      rating = "great";
      reason = "Perfect sunset walk conditions \u2014 comfortable temp and calm wind.";
      tip = "Bring a light jacket for after the sun dips.";
    } else if (isNight && !windDiscomfort && feelsLike >= 55) {
      rating = "good";
      reason = `Dark out, but feels like ${displayTemp(feelsLike)} with tolerable wind.`;
      tip = "A jacket will keep you comfortable.";
    } else if (windDiscomfort) {
      rating = feelsLike < 55 ? "bad" : "poor";
      reason = `Wind at ${Math.round(wind)} mph (gusts ${Math.round(gusts)}) will feel cold${feelsLike < 60 ? ` at ${displayTemp(feelsLike)}` : ""}.`;
      tip = "Consider waiting for calmer conditions, or stick to streets with building cover.";
    } else if (feelsLike < 55) {
      rating = "poor";
      reason = `Feels like only ${displayTemp(feelsLike)} \u2014 quite cold for a walk.`;
      tip = "Bundle up well, or wait for a warmer window.";
    } else {
      rating = "fair";
      reason = `Feels like ${displayTemp(feelsLike)} \u2014 manageable with a layer.`;
      tip = isSunsetTime ? "Bring a jacket \u2014 it'll cool off fast after sunset." : "";
    }

    if (isFoggy && rating !== "bad") {
      if (tip) tip += " Visibility is low \u2014 be careful at crossings.";
      else tip = "Visibility is low \u2014 be careful at crossings.";
    }

    const walkLayer = layeringAdvice(feelsLike, wind);
    if (tip) tip += ` Wear: ${walkLayer}.`;
    else tip = `Wear: ${walkLayer}.`;

    const walkType = isNight ? "Night Walk" : isSunsetTime ? "Sunset Walk" : "Neighborhood Walk";
    activities.push({
      icon: isNight ? "\uD83C\uDF19" : isSunsetTime ? "\uD83C\uDF05" : "\uD83D\uDEB6",
      name: walkType,
      rating,
      reason,
      tip,
    });

    // If it's daytime, also show what sunset walk will be like
    if (isDaytime) {
      const sh = hourlyAt(data.hourly, sunset);
      if (sh) {
        const sunsetFeels = sh.feelsLike;
        const sunsetWindBad = sh.wind >= thresholds.walkWindMax || (sunsetFeels < 60 && sh.wind >= 10);
        let sRating, sReason, sTip;

        const sunsetLayer = layeringAdvice(sunsetFeels, sh.wind);
        if (sunsetWindBad) {
          sRating = sunsetFeels < 55 ? "bad" : "poor";
          sReason = `Sunset forecast: feels like ${displayTemp(sunsetFeels)}, wind ${Math.round(sh.wind)} mph. Wind chill will be uncomfortable.`;
          sTip = `Consider skipping the sunset walk tonight. Wear: ${sunsetLayer}.`;
        } else if (sunsetFeels >= thresholds.sunsetGreat) {
          sRating = "great";
          sReason = `Sunset forecast: ${displayTemp(sunsetFeels)} feels-like, wind ${Math.round(sh.wind)} mph.`;
          sTip = `Looks like a nice evening for it! Wear: ${sunsetLayer}.`;
        } else {
          sRating = "fair";
          sReason = `Sunset forecast: feels like ${displayTemp(sunsetFeels)}.`;
          sTip = `Wear: ${sunsetLayer}.`;
        }

        activities.push({
          icon: "\uD83C\uDF05",
          name: "Sunset Walk (forecast)",
          rating: sRating,
          reason: sReason,
          tip: sTip,
        });
      }
    }
  }

  return activities;
}

async function fetchWeather() {
  const params = new URLSearchParams({
    latitude: LAT,
    longitude: LON,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_gusts_10m",
      "uv_index",
    ].join(","),
    hourly: [
      "temperature_2m",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_gusts_10m",
      "apparent_temperature",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "sunrise",
      "sunset",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: TIME_ZONE,
    timeformat: "unixtime", // absolute times, not device-local strings
    forecast_days: 7,
  });

  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`);
  return resp.json();
}

function renderCurrent(data) {
  const c = data.current;
  const daily = data.daily;
  const now = new Date();

  document.getElementById("temp").textContent = displayTempValue(c.temperature_2m);
  document.getElementById("temp-unit").textContent = unitLabel();
  document.getElementById("weather-desc").textContent = getWeatherInfo(c.weather_code).desc;
  document.getElementById("feels-like").textContent = displayTemp(c.apparent_temperature);
  document.getElementById("wind").textContent = `${Math.round(c.wind_speed_10m)} mph`;
  document.getElementById("gusts").textContent = `${Math.round(c.wind_gusts_10m)} mph`;
  document.getElementById("humidity").textContent = `${c.relative_humidity_2m}%`;
  document.getElementById("uv").textContent = c.uv_index.toFixed(1);

  const sunrise = unixDate(daily.sunrise[0]);
  const sunset = unixDate(daily.sunset[0]);
  document.getElementById("sunrise").textContent = formatTime(sunrise);
  document.getElementById("sunset").textContent = formatTime(sunset);

  const isSkyClearAt = (time) => {
    const h = hourlyAt(data.hourly, time);
    return !h || isSkyClear(h.code, h.cloudCover);
  };
  const sunStatus = backyardSunStatus(
    now, sunrise, sunset, isSkyClear(c.weather_code, c.cloud_cover), isSkyClearAt
  );
  document.getElementById("sun-status").textContent = sunStatus.label;

  // Show sun windows for the yard
  const windowsEl = document.getElementById("sun-windows");
  const formatSunWindows = (windows) => windows
    .map((w) => `${formatTime(w.start)}\u2013${formatTime(w.end)} (peak ${Math.round(w.peakFraction * 100)}%)`)
    .join(", ");
  if (sunStatus.windows.length > 0) {
    windowsEl.textContent = formatSunWindows(sunStatus.windows);
  } else if (sunStatus.clearSkyWindows.length > 0) {
    windowsEl.textContent = `None \u2014 clouds forecast over ${formatSunWindows(sunStatus.clearSkyWindows)}`;
  } else {
    windowsEl.textContent = "No direct sun today";
  }

  document.getElementById("loading").hidden = true;
  document.getElementById("current-grid").hidden = false;

  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    wind: c.wind_speed_10m,
    gusts: c.wind_gusts_10m,
    humidity: c.relative_humidity_2m,
    uv: c.uv_index,
    code: c.weather_code,
    sunrise,
    sunset,
    sunStatus,
  };
}

function renderActivities(activities) {
  const container = document.getElementById("activity-list");
  container.innerHTML = "";

  // Cards stay in the fixed order rateActivities builds them in (not sorted by
  // rating) so they don't shift around between visits
  for (const act of activities) {
    const div = document.createElement("div");
    div.className = `activity-item ${act.rating}`;

    const iconEl = document.createElement("div");
    iconEl.className = "activity-icon";
    iconEl.textContent = act.icon;

    const body = document.createElement("div");
    body.className = "activity-body";

    const h3 = document.createElement("h3");
    h3.textContent = act.name + " ";
    const ratingSpan = document.createElement("span");
    ratingSpan.className = "activity-rating";
    ratingSpan.textContent = act.rating;
    h3.appendChild(ratingSpan);

    const reasonP = document.createElement("p");
    reasonP.className = "activity-reason";
    reasonP.textContent = act.reason;

    body.appendChild(h3);
    body.appendChild(reasonP);

    if (act.tip) {
      const tipP = document.createElement("p");
      tipP.className = "activity-tip";
      tipP.textContent = act.tip;
      body.appendChild(tipP);
    }

    div.appendChild(iconEl);
    div.appendChild(body);
    container.appendChild(div);
  }

  document.getElementById("activities").hidden = false;
}

function renderTides(tideData) {
  const container = document.getElementById("tide-info");
  container.innerHTML = "";

  if (tideData.tides.length === 0) {
    container.innerHTML = '<p class="tide-note">No tide data available.</p>';
    document.getElementById("tides").hidden = false;
    return;
  }

  const today = localDateKey(new Date());
  const shownDays = [today, shiftDateKey(today, 1)];
  for (const t of tideData.tides.filter((e) => shownDays.includes(localDateKey(e.time)))) {
    const div = document.createElement("div");
    div.className = `tide-event ${t.type.toLowerCase()}`;
    div.innerHTML = `
      <span class="tide-type">${t.type === "High" ? "\u2B06\uFE0F" : "\u2B07\uFE0F"} ${t.type} Tide</span>
      <span>${formatTime(t.time)}</span>
      <span>${t.height} ft</span>
    `;
    container.appendChild(div);
  }

  if (tideData.isSpringTide) {
    const note = document.createElement("p");
    note.className = "tide-note";
    note.textContent = "Spring tide \u2014 expect higher highs and lower lows. Great for beach running at low tide!";
    container.appendChild(note);
  }

  const note = document.createElement("p");
  note.className = "tide-note";
  note.textContent = "Tide data from NOAA Station 9410840 (Santa Monica).";
  container.appendChild(note);

  document.getElementById("tides").hidden = false;
}

// One hour of the hourly forecast
function forecastHour(hourly, i) {
  return {
    time: hourly.time[i],
    temperature: hourly.temperature_2m[i],
    wind: hourly.wind_speed_10m[i],
    gusts: hourly.wind_gusts_10m[i],
    code: hourly.weather_code[i],
    cloudCover: hourly.cloud_cover[i],
    feelsLike: hourly.apparent_temperature[i],
  };
}

// Forecast for the hour nearest `time`, or null if it's outside the forecast
function hourlyAt(hourly, time) {
  const i = hourly.time.findIndex((t) => Math.abs(unixDate(t) - time) <= 30 * 60 * 1000);
  return i < 0 ? null : forecastHour(hourly, i);
}

function renderHourly(data) {
  const container = document.getElementById("hourly-scroll");
  const scrollLeft = container.scrollLeft;
  container.innerHTML = "";

  const now = new Date();
  const startIdx = data.hourly.time.findIndex((t) => unixDate(t) >= now);
  if (startIdx < 0) return;

  const hours = [];
  for (let i = startIdx; i < Math.min(startIdx + 12, data.hourly.time.length); i++) {
    hours.push(forecastHour(data.hourly, i));
  }

  for (const h of hours) {
    const div = document.createElement("div");
    div.className = "hour-item";
    div.innerHTML = `
      <div class="hour-time">${formatHour(h.time)}</div>
      <div class="hour-icon">${getWeatherInfo(h.code).icon}</div>
      <div class="hour-temp">${displayTempValue(h.temperature)}\u00B0</div>
      <div class="hour-feels">Feels ${displayTempValue(h.feelsLike)}\u00B0</div>
      <div class="hour-wind">${Math.round(h.wind)} mph</div>
    `;
    container.appendChild(div);
  }
  container.scrollLeft = scrollLeft;

  document.getElementById("hourly").hidden = false;
}

function renderWeekly(data) {
  const container = document.getElementById("weekly-grid");
  container.innerHTML = "";

  const daily = data.daily;
  const allTemps = [...daily.temperature_2m_min, ...daily.temperature_2m_max];
  const globalMin = Math.min(...allTemps);
  const globalMax = Math.max(...allTemps);
  const range = globalMax - globalMin || 1;

  for (let i = 0; i < daily.time.length; i++) {
    const lo = daily.temperature_2m_min[i];
    const hi = daily.temperature_2m_max[i];
    const leftPct = ((lo - globalMin) / range) * 100;
    const widthPct = ((hi - lo) / range) * 100;

    const div = document.createElement("div");
    div.className = "day-row";
    div.innerHTML = `
      <span class="day-name">${dayName(daily.time[i])}</span>
      <span class="day-icon">${getWeatherInfo(daily.weather_code[i]).icon}</span>
      <div class="day-bar-container">
        <div class="day-bar" style="margin-left:${leftPct}%;width:${Math.max(widthPct, 4)}%"></div>
      </div>
      <span class="day-temps"><span class="lo">${displayTempValue(lo)}\u00B0</span> / ${displayTempValue(hi)}\u00B0</span>
    `;
    container.appendChild(div);
  }

  document.getElementById("week").hidden = false;
}

let cachedData = null;
let cachedTideData = null;
let lastRenderState = null; // cached intermediate values for targeted re-render
let lastFetchTime = 0; // when the data on screen was fetched
const EMPTY_TIDES = { tides: [], isSpringTide: false };
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_VERSION = "2"; // bump when the cached data format changes

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (el) {
    el.textContent = `Last updated: ${formatTime(new Date(lastFetchTime))}`;
  }
}

function renderAll(data, tideData) {
  const weather = renderCurrent(data);
  renderHourly(data);

  renderTides(tideData);
  renderWeekly(data);

  lastRenderState = { weather, tideData, data };

  reRenderActivities();
  updateLastUpdated();
}

function reRenderActivities() {
  if (!lastRenderState) return;
  const { weather, tideData, data } = lastRenderState;
  const activities = rateActivities(weather, tideData, weather.sunStatus, data);
  renderActivities(activities);
}

function toggleUnit() {
  tempUnit = tempUnit === "C" ? "F" : "C";
  localStorage.setItem("tempUnit", tempUnit);
  document.getElementById("unit-toggle").textContent =
    tempUnit === "C" ? "Switch to \u00B0F" : "Switch to \u00B0C";
  renderSettings();
  if (cachedData && cachedTideData) renderAll(cachedData, cachedTideData);
}

function toggleSettings() {
  const el = document.getElementById("settings");
  el.hidden = !el.hidden;
  if (!el.hidden) renderSettings();
}

const THRESHOLD_LABELS = {
  backyardGreat: "Backyard \u2014 great",
  backyardGood: "Backyard \u2014 good",
  palisadesGreat: "Palisades \u2014 great",
  palisadesGood: "Palisades \u2014 good",
  walkGreat: "Walk \u2014 great",
  sunsetGreat: "Sunset walk \u2014 great",
  walkWindMax: "Max wind (mph)",
};

function renderSettings() {
  const grid = document.getElementById("settings-grid");
  grid.innerHTML = "";

  for (const [key, label] of Object.entries(THRESHOLD_LABELS)) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const isWind = key === "walkWindMax";
    const displayVal = isWind
      ? thresholds[key]
      : displayTempValue(thresholds[key]);
    const suffix = isWind ? " mph" : ` ${unitLabel()}`;

    row.innerHTML = `
      <label>${label}</label>
      <div class="settings-input-group">
        <input type="number" value="${displayVal}" data-key="${key}" data-is-wind="${isWind}" class="settings-input">
        <span class="settings-suffix">${suffix}</span>
      </div>
    `;
    grid.appendChild(row);

    const input = row.querySelector("input");
    input.addEventListener("change", (e) => {
      const val = parseFloat(e.target.value);
      if (isNaN(val)) return;
      thresholds[key] = isWind ? val : inputToF(val);
      saveThresholds(thresholds);
      reRenderActivities();
    });
  }
}

function resetThresholds() {
  thresholds = { ...DEFAULT_THRESHOLDS };
  saveThresholds(thresholds);
  renderSettings();
  reRenderActivities();
}

// Save/load cached API data from localStorage for instant render
function saveToLocalCache(weatherData, tideData) {
  try {
    localStorage.setItem("cachedWeather", JSON.stringify(weatherData));
    localStorage.setItem("cachedTides", JSON.stringify(tideData));
    localStorage.setItem("cachedTime", lastFetchTime.toString());
    localStorage.setItem("cacheVersion", CACHE_VERSION);
  } catch (e) { /* quota exceeded — ignore */ }
}

function loadFromLocalCache() {
  try {
    const weather = localStorage.getItem("cachedWeather");
    const tides = localStorage.getItem("cachedTides");
    const time = localStorage.getItem("cachedTime");
    if (!weather || !tides || !time) return null;
    if (localStorage.getItem("cacheVersion") !== CACHE_VERSION) return null;
    const age = Date.now() - parseInt(time, 10);
    if (age > 60 * 60 * 1000) return null; // discard if older than 1 hour
    const tideData = JSON.parse(tides);
    // Restore Date objects from serialized tide data
    if (tideData.tides) {
      tideData.tides = tideData.tides.map((t) => ({ ...t, time: new Date(t.time) }));
    }
    return { weather: JSON.parse(weather), tides: tideData, time: parseInt(time, 10) };
  } catch (e) { return null; }
}

async function fetchAllData() {
  const [weatherResult, tideResult] = await Promise.allSettled([
    fetchWeather(),
    fetchTides(new Date()),
  ]);

  if (weatherResult.status === "rejected") {
    throw new Error(`Weather: ${weatherResult.reason.message}`);
  }

  const weatherData = weatherResult.value;
  let tideData;

  if (tideResult.status === "rejected") {
    console.error("Tide fetch failed, using empty tides:", tideResult.reason);
    tideData = EMPTY_TIDES;
  } else {
    tideData = tideResult.value;
  }

  lastFetchTime = Date.now();
  return { weatherData, tideData };
}

// Fetch fresh data and re-render (one request at a time); rejects if the
// weather fetch fails
let refreshInFlight = null;
function refresh() {
  if (!refreshInFlight) {
    refreshInFlight = fetchAllData()
      .then(({ weatherData, tideData }) => {
        cachedData = weatherData;
        cachedTideData = tideData;
        saveToLocalCache(cachedData, cachedTideData);
        renderAll(cachedData, cachedTideData);
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function init() {
  // Set initial toggle button text
  document.getElementById("unit-toggle").textContent =
    tempUnit === "C" ? "Switch to \u00B0F" : "Switch to \u00B0C";

  // Try to render from local cache immediately for a fast first paint
  const localCache = loadFromLocalCache();
  if (localCache) {
    cachedData = localCache.weather;
    cachedTideData = localCache.tides;
    lastFetchTime = localCache.time;
    renderAll(cachedData, cachedTideData);
  }

  try {
    await refresh();
  } catch (err) {
    // If we already rendered from cache, keep showing that
    if (!localCache) {
      document.getElementById("loading").textContent =
        `Failed to load weather data: ${err.message}. Retrying every minute\u2026`;
    }
    console.error(err);
  }
}

// Ratings and the sun status depend on the time of day, so re-render every
// minute while the app is open, and refetch once the data is 15+ minutes old
async function tick() {
  if (document.hidden) return;
  if (Date.now() - lastFetchTime >= REFRESH_INTERVAL_MS) {
    try {
      await refresh();
      return;
    } catch (err) {
      console.error("Auto-refresh failed:", err);
    }
  }
  if (cachedData && cachedTideData) renderAll(cachedData, cachedTideData);
}

document.addEventListener("visibilitychange", tick);
setInterval(tick, 60 * 1000);

init();
