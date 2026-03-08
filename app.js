// Santa Monica coordinates (6th & Wilshire area)
const LAT = 34.0259;
const LON = -118.4930;

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
const YARD_SIZE = 30; // feet, square yard
const WALL_HEIGHT = 25; // feet, two-story buildings on all sides
const SUN_THRESHOLD = 0.25; // need 25% of yard sunlit
const SHADOW_GRID = 20; // sample points per axis for shadow calculation

// Solar position calculator using NOAA equations
function solarPosition(date) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // Julian day
  const JD =
    Math.floor(365.25 * (date.getUTCFullYear() + 4716)) +
    Math.floor(30.6001 * ((date.getUTCMonth() + 1 < 3 ? date.getUTCMonth() + 13 : date.getUTCMonth() + 1 + 1))) +
    date.getUTCDate() +
    (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600) / 24 -
    1524.5;

  // Simplified: use day-of-year approach for declination + equation of time
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date - start) / 86400000) + 1;
  const B = ((360 / 365) * (dayOfYear - 81)) * rad;

  // Equation of time (minutes) — Spencer (1971)
  const EoT =
    9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Solar declination (degrees)
  const declination = 23.45 * Math.sin(((284 + dayOfYear) * 360 / 365) * rad);

  // Solar time
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTime = utcHours + LON / 15 + EoT / 60; // hours
  const hourAngle = (solarTime - 12) * 15; // degrees

  const latRad = LAT * rad;
  const declRad = declination * rad;
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
// Yard coordinate system: x=0 is west wall, x=YARD_SIZE is east wall,
// y=0 is south wall, y=YARD_SIZE is north wall
function isPointSunlit(x, y, elevation, azimuth) {
  const rad = Math.PI / 180;
  const tanElev = Math.tan(elevation * rad);
  const sinAz = Math.sin(azimuth * rad);
  const cosAz = Math.cos(azimuth * rad);

  // Ray from (x, y, 0) toward sun direction (sinAz, cosAz, tanElev)
  // Check if ray intersects any wall below the wall's height

  // South wall (y=0): blocks when sun is south (cosAz < 0)
  if (cosAz < 0) {
    const t = -y / cosAz;
    const xHit = x + t * sinAz;
    const zHit = t * tanElev;
    if (xHit >= 0 && xHit <= YARD_SIZE && zHit <= WALL_HEIGHT) return false;
  }

  // North wall (y=YARD_SIZE): blocks when sun is north (cosAz > 0)
  if (cosAz > 0) {
    const t = (YARD_SIZE - y) / cosAz;
    const xHit = x + t * sinAz;
    const zHit = t * tanElev;
    if (xHit >= 0 && xHit <= YARD_SIZE && zHit <= WALL_HEIGHT) return false;
  }

  // East wall (x=YARD_SIZE): blocks when sun is east (sinAz > 0)
  if (sinAz > 0) {
    const t = (YARD_SIZE - x) / sinAz;
    const yHit = y + t * cosAz;
    const zHit = t * tanElev;
    if (yHit >= 0 && yHit <= YARD_SIZE && zHit <= WALL_HEIGHT) return false;
  }

  // West wall (x=0): blocks when sun is west (sinAz < 0)
  if (sinAz < 0) {
    const t = -x / sinAz;
    const yHit = y + t * cosAz;
    const zHit = t * tanElev;
    if (yHit >= 0 && yHit <= YARD_SIZE && zHit <= WALL_HEIGHT) return false;
  }

  return true;
}

// Calculate fraction of backyard receiving direct sun at a given moment
function backyardSunFraction(date) {
  const { elevation, azimuth } = solarPosition(date);
  if (elevation <= 0) return { fraction: 0, elevation, azimuth };

  let sunlit = 0;
  const total = SHADOW_GRID * SHADOW_GRID;
  const step = YARD_SIZE / SHADOW_GRID;

  for (let i = 0; i < SHADOW_GRID; i++) {
    for (let j = 0; j < SHADOW_GRID; j++) {
      const x = (i + 0.5) * step;
      const y = (j + 0.5) * step;
      if (isPointSunlit(x, y, elevation, azimuth)) sunlit++;
    }
  }

  return { fraction: sunlit / total, elevation, azimuth };
}

// Find today's sun windows where >= 25% of the yard is lit
// Returns array of { start, end, peakFraction, peakTime }
function findSunWindows(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const windows = [];
  let currentWindow = null;
  let peakFraction = 0;
  let peakTime = null;

  // Scan every 10 minutes from 6am to 8pm local
  for (let min = 6 * 60; min <= 20 * 60; min += 10) {
    const t = new Date(day.getTime() + min * 60 * 1000);
    const { fraction } = backyardSunFraction(t);

    if (fraction >= SUN_THRESHOLD) {
      if (!currentWindow) {
        currentWindow = { start: t, end: t };
        peakFraction = fraction;
        peakTime = t;
      } else {
        currentWindow.end = t;
        if (fraction > peakFraction) {
          peakFraction = fraction;
          peakTime = t;
        }
      }
    } else if (currentWindow) {
      currentWindow.peakFraction = peakFraction;
      currentWindow.peakTime = peakTime;
      windows.push(currentWindow);
      currentWindow = null;
      peakFraction = 0;
      peakTime = null;
    }
  }

  if (currentWindow) {
    currentWindow.peakFraction = peakFraction;
    currentWindow.peakTime = peakTime;
    windows.push(currentWindow);
  }

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

// Approximate tide estimation using lunar phase (simplified harmonic)
// Real apps would use a tide API — this gives a reasonable approximation for Santa Monica Bay
function estimateTides(now) {
  const LUNAR_CYCLE_MS = 29.53059 * 24 * 3600 * 1000;
  // Known new moon reference: Jan 6 2000 18:14 UTC
  const REF_NEW_MOON = new Date("2000-01-06T18:14:00Z").getTime();
  const lunarAge = ((now.getTime() - REF_NEW_MOON) % LUNAR_CYCLE_MS + LUNAR_CYCLE_MS) % LUNAR_CYCLE_MS;
  const lunarPhase = lunarAge / LUNAR_CYCLE_MS; // 0-1

  // Semi-diurnal tide: ~2 highs and 2 lows per day
  // Tides shift ~50 min later each day (lunar day = 24h 50min)
  const LUNAR_DAY_MS = (24 * 60 + 50) * 60 * 1000;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  // Phase offset based on lunar age
  const phaseOffset = (lunarAge / LUNAR_DAY_MS) * 2 * Math.PI;

  const tides = [];
  for (let i = 0; i < 4; i++) {
    const t = (i * LUNAR_DAY_MS) / 4;
    const tideTime = new Date(dayStart.getTime() + t + (phaseOffset / (2 * Math.PI)) * (LUNAR_DAY_MS / 2) % LUNAR_DAY_MS);

    // Keep only tides for today/tomorrow
    if (tideTime < dayStart || tideTime > new Date(dayStart.getTime() + 36 * 3600 * 1000)) continue;

    const isHigh = i % 2 === 0;
    // Spring tides near new/full moon, neap tides near quarters
    const springFactor = Math.abs(Math.cos(lunarPhase * 2 * Math.PI));
    const height = isHigh
      ? 3.5 + springFactor * 2.0
      : 1.5 - springFactor * 0.8;

    tides.push({
      time: tideTime,
      type: isHigh ? "High" : "Low",
      height: height.toFixed(1),
    });
  }

  // Add a second cycle
  for (let i = 0; i < 4; i++) {
    const t = (i * LUNAR_DAY_MS) / 4 + LUNAR_DAY_MS / 2;
    const tideTime = new Date(dayStart.getTime() + t + (phaseOffset / (2 * Math.PI)) * (LUNAR_DAY_MS / 2) % LUNAR_DAY_MS);
    if (tideTime < dayStart || tideTime > new Date(dayStart.getTime() + 36 * 3600 * 1000)) continue;

    const isHigh = i % 2 === 0;
    const springFactor = Math.abs(Math.cos(lunarPhase * 2 * Math.PI));
    const height = isHigh
      ? 3.5 + springFactor * 1.8
      : 1.5 - springFactor * 0.7;

    tides.push({
      time: tideTime,
      type: isHigh ? "High" : "Low",
      height: height.toFixed(1),
    });
  }

  tides.sort((a, b) => a.time - b.time);

  // Deduplicate tides that are too close together
  const filtered = [];
  for (const t of tides) {
    if (filtered.length === 0 || t.time - filtered[filtered.length - 1].time > 2 * 3600 * 1000) {
      filtered.push(t);
    }
  }

  const isSpringTide = lunarPhase < 0.07 || (lunarPhase > 0.46 && lunarPhase < 0.54) || lunarPhase > 0.93;
  return { tides: filtered, isSpringTide, lunarPhase };
}

// Continuous tide height at any moment (sinusoidal interpolation between high/low events)
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
      // Cosine interpolation for smooth tide curve
      const frac = (t - t0) / (t1 - t0);
      return h0 + (h1 - h0) * (0.5 - 0.5 * Math.cos(Math.PI * frac));
    }
  }

  // Before first event or after last: extrapolate from nearest
  if (t < events[0].time.getTime() && events.length >= 2) {
    const t0 = events[0].time.getTime();
    const t1 = events[1].time.getTime();
    const period = (t1 - t0) * 2;
    const h0 = parseFloat(events[0].height);
    const h1 = parseFloat(events[1].height);
    const hPrev = h1; // assume mirrored
    const frac = 1 - (t0 - t) / (t1 - t0);
    if (frac >= 0) return hPrev + (h0 - hPrev) * (0.5 - 0.5 * Math.cos(Math.PI * frac));
  }

  return parseFloat(events[events.length - 1].height);
}

// Find joggable beach windows: daylight AND tide < 2 ft
function findJoggableWindows(sunrise, sunset, tideData) {
  const sunriseTime = new Date(sunrise).getTime();
  const sunsetTime = new Date(sunset).getTime();
  const windows = [];
  let currentWindow = null;
  const STEP_MS = 10 * 60 * 1000; // 10-minute steps
  const MAX_TIDE = 2.0; // feet

  for (let t = sunriseTime; t <= sunsetTime; t += STEP_MS) {
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

function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function formatHour(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function dayName(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const today = new Date(now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }));
  const target = new Date(d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }));
  const diff = (target - today) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" });
}

// Wind chill approximation (Fahrenheit)
function windChill(tempF, windMph) {
  if (tempF > 50 || windMph < 3) return tempF;
  return (
    35.74 +
    0.6215 * tempF -
    35.75 * Math.pow(windMph, 0.16) +
    0.4275 * tempF * Math.pow(windMph, 0.16)
  );
}

// Determine if the sun is currently shining on the backyard using shadow geometry
function backyardSunStatus(now, sunrise, sunset) {
  const sunriseDate = new Date(sunrise);
  const sunsetDate = new Date(sunset);
  if (now < sunriseDate) return { hasSun: false, fraction: 0, label: "Before sunrise", windows: findSunWindows(now) };
  if (now > sunsetDate) return { hasSun: false, fraction: 0, label: "After sunset", windows: [] };

  const { fraction, elevation } = backyardSunFraction(now);
  const pct = Math.round(fraction * 100);
  const windows = findSunWindows(now);

  if (fraction < 0.01) {
    return {
      hasSun: false,
      fraction,
      label: `No \u2014 buildings block sun (elev ${elevation.toFixed(0)}\u00B0)`,
      windows,
    };
  }

  const label = `Yes \u2014 ${pct}% of yard in direct sun`;
  return { hasSun: fraction >= SUN_THRESHOLD, fraction, label, windows };
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
function rateActivities(weather, tideData, sunStatus, hourly, sunrise, sunset) {
  const temp = weather.temperature;
  const feelsLike = weather.feelsLike;
  const wind = weather.wind;
  const gusts = weather.gusts;
  const isRaining = weather.code >= 51;
  const uv = weather.uv;
  const now = new Date();
  const hour = parseInt(now.toLocaleTimeString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));

  const activities = [];

  // 1. Backyard hangout
  {
    let rating, reason, tip;
    if (!sunStatus.hasSun) {
      if (feelsLike >= 65) {
        rating = "fair";
        reason = "No direct sun on the backyard right now, but it's warm enough.";
        tip = "Grab a blanket if you're sitting still.";
      } else {
        rating = "poor";
        reason = `No direct sun, and it feels like ${displayTemp(feelsLike)} \u2014 it'll feel cold quickly.`;
        tip = "Wait for morning sun tomorrow, or head to a sunnier spot.";
      }
    } else if (isRaining) {
      rating = "bad";
      reason = "Rain expected \u2014 not great for the backyard.";
      tip = "";
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
    } else if (feelsLike >= thresholds.palisadesGreat && wind < thresholds.walkWindMax && !isRaining) {
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

  // 3. Beach run — only during daylight with tide < 2 ft
  {
    let rating, reason, tip;
    const joggableWindows = findJoggableWindows(sunrise, sunset, tideData);
    const currentTide = tideHeightAt(now, tideData);
    const isDaylight = now >= new Date(sunrise) && now <= new Date(sunset);
    const tideOk = currentTide !== null && currentTide < 2.0;
    const isJoggableNow = isDaylight && tideOk;

    const windowStrs = joggableWindows.map((w) =>
      `${formatTime(w.start)}\u2013${formatTime(w.end)} (low ${w.minTide.toFixed(1)} ft)`
    );

    if (joggableWindows.length === 0) {
      rating = "bad";
      reason = "No joggable windows today \u2014 tide stays above 2 ft during daylight.";
      tip = "";
    } else if (isJoggableNow) {
      rating = isRaining ? "fair" : "great";
      reason = isRaining
        ? `Tide is ${currentTide.toFixed(1)} ft (runnable) but it's raining.`
        : `Tide is ${currentTide.toFixed(1)} ft \u2014 go now!`;
      tip = `Today\u2019s windows: ${windowStrs.join(", ")}`;
    } else if (!isDaylight) {
      rating = "poor";
      reason = "Too dark to run on the beach right now.";
      tip = joggableWindows.length > 0
        ? `Tomorrow\u2019s daylight windows: ${windowStrs.join(", ")}`
        : "";
    } else {
      // Daylight but tide too high
      const nextWindow = joggableWindows.find((w) => w.start > now);
      rating = "poor";
      reason = `Tide is ${currentTide !== null ? currentTide.toFixed(1) : "?"} ft \u2014 too high (need < 2 ft).`;
      tip = nextWindow
        ? `Next window: ${formatTime(nextWindow.start)}\u2013${formatTime(nextWindow.end)}`
        : `Today\u2019s windows: ${windowStrs.join(", ")}`;
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

  // 4. Neighborhood walk (sun / sunset / late night)
  {
    let rating, reason, tip;
    const isSunsetHour = hour >= 17 && hour <= 19;
    const isLateNight = hour >= 21 || hour < 5;
    const isDaytime = !isSunsetHour && !isLateNight;

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
    } else if (isSunsetHour && !windDiscomfort && feelsLike >= thresholds.sunsetGreat) {
      rating = "great";
      reason = "Perfect sunset walk conditions \u2014 comfortable temp and calm wind.";
      tip = "Bring a light jacket for after the sun dips.";
    } else if (isLateNight && !windDiscomfort && feelsLike >= 55) {
      rating = "good";
      reason = `Late night feels like ${displayTemp(feelsLike)} with tolerable wind.`;
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
      tip = isSunsetHour ? "Bring a jacket \u2014 it'll cool off fast after sunset." : "";
    }

    const walkLayer = layeringAdvice(feelsLike, wind);
    if (tip) tip += ` Wear: ${walkLayer}.`;
    else tip = `Wear: ${walkLayer}.`;

    const walkType = isLateNight ? "Late Night Walk" : isSunsetHour ? "Sunset Walk" : "Neighborhood Walk";
    activities.push({
      icon: isLateNight ? "\uD83C\uDF19" : isSunsetHour ? "\uD83C\uDF05" : "\uD83D\uDEB6",
      name: walkType,
      rating,
      reason,
      tip,
    });

    // If it's daytime, also show what sunset walk will be like
    if (isDaytime && hourly.length > 0) {
      const sunsetIdx = hourly.findIndex((h) => {
        const hHour = new Date(h.time).getHours();
        return hHour >= 17 && hHour <= 18;
      });
      if (sunsetIdx >= 0) {
        const sh = hourly[sunsetIdx];
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
      "wind_speed_10m",
      "wind_gusts_10m",
      "uv_index",
    ].join(","),
    hourly: [
      "temperature_2m",
      "weather_code",
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
    timezone: "America/Los_Angeles",
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

  const sunrise = daily.sunrise[0];
  const sunset = daily.sunset[0];
  document.getElementById("sunrise").textContent = formatTime(new Date(sunrise));
  document.getElementById("sunset").textContent = formatTime(new Date(sunset));

  const sunStatus = backyardSunStatus(now, sunrise, sunset);
  document.getElementById("sun-status").textContent = sunStatus.label;

  // Show sun windows for the yard
  const windowsEl = document.getElementById("sun-windows");
  if (windowsEl && sunStatus.windows && sunStatus.windows.length > 0) {
    const windowStrs = sunStatus.windows.map((w) => {
      const pct = Math.round(w.peakFraction * 100);
      return `${formatTime(w.start)}\u2013${formatTime(w.end)} (peak ${pct}%)`;
    });
    windowsEl.textContent = windowStrs.join(", ");
  } else if (windowsEl) {
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

  const order = { great: 0, good: 1, fair: 2, poor: 3, bad: 4 };
  activities.sort((a, b) => order[a.rating] - order[b.rating]);

  for (const act of activities) {
    const div = document.createElement("div");
    div.className = `activity-item ${act.rating}`;
    div.innerHTML = `
      <div class="activity-icon">${act.icon}</div>
      <div class="activity-body">
        <h3>${act.name} <span class="activity-rating">${act.rating}</span></h3>
        <p class="activity-reason">${act.reason}</p>
        ${act.tip ? `<p class="activity-tip">${act.tip}</p>` : ""}
      </div>
    `;
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

  for (const t of tideData.tides) {
    const div = document.createElement("div");
    div.className = `tide-event ${t.type.toLowerCase()}`;
    div.innerHTML = `
      <span class="tide-type">${t.type === "High" ? "\u2B06\uFE0F" : "\u2B07\uFE0F"} ${t.type} Tide</span>
      <span>${formatTime(t.time)}</span>
      <span>~${t.height} ft</span>
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
  note.textContent = "Tide times are estimated. Check local tide tables for exact times.";
  container.appendChild(note);

  document.getElementById("tides").hidden = false;
}

function renderHourly(data) {
  const container = document.getElementById("hourly-scroll");
  container.innerHTML = "";

  const now = new Date();
  const currentHourISO = data.hourly.time.find((t) => new Date(t) >= now);
  const startIdx = data.hourly.time.indexOf(currentHourISO);
  if (startIdx < 0) return;

  const hours = [];
  for (let i = startIdx; i < Math.min(startIdx + 12, data.hourly.time.length); i++) {
    hours.push({
      time: data.hourly.time[i],
      temperature: data.hourly.temperature_2m[i],
      wind: data.hourly.wind_speed_10m[i],
      gusts: data.hourly.wind_gusts_10m[i],
      code: data.hourly.weather_code[i],
      feelsLike: data.hourly.apparent_temperature[i],
    });
  }

  for (const h of hours) {
    const div = document.createElement("div");
    div.className = "hour-item";
    div.innerHTML = `
      <div class="hour-time">${formatHour(h.time)}</div>
      <div class="hour-icon">${getWeatherInfo(h.code).icon}</div>
      <div class="hour-temp">${displayTempValue(h.temperature)}\u00B0</div>
      <div class="hour-wind">${Math.round(h.wind)} mph</div>
    `;
    container.appendChild(div);
  }

  document.getElementById("hourly").hidden = false;
  return hours;
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

function renderAll(data, tideData) {
  const weather = renderCurrent(data);
  const hourly = renderHourly(data);

  renderTides(tideData);
  renderWeekly(data);

  const activities = rateActivities(
    weather,
    tideData,
    weather.sunStatus,
    hourly || [],
    data.daily.sunrise[0],
    data.daily.sunset[0]
  );
  renderActivities(activities);
}

function toggleUnit() {
  tempUnit = tempUnit === "C" ? "F" : "C";
  localStorage.setItem("tempUnit", tempUnit);
  document.getElementById("unit-toggle").textContent =
    tempUnit === "C" ? "Switch to \u00B0F" : "Switch to \u00B0C";
  renderSettings(); // update displayed values in settings
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
      if (cachedData && cachedTideData) renderAll(cachedData, cachedTideData);
    });
  }
}

function resetThresholds() {
  thresholds = { ...DEFAULT_THRESHOLDS };
  saveThresholds(thresholds);
  renderSettings();
  if (cachedData && cachedTideData) renderAll(cachedData, cachedTideData);
}

async function init() {
  try {
    cachedData = await fetchWeather();
    cachedTideData = estimateTides(new Date());

    // Set initial toggle button text
    document.getElementById("unit-toggle").textContent =
      tempUnit === "C" ? "Switch to \u00B0F" : "Switch to \u00B0C";

    renderAll(cachedData, cachedTideData);
  } catch (err) {
    document.getElementById("loading").textContent =
      `Failed to load weather data: ${err.message}. Please refresh to try again.`;
    console.error(err);
  }
}

init();
