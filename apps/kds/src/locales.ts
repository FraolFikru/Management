/* =========================================================
   UI translations. Keys are the English source text.
   am = Amharic (አማርኛ), om = Afaan Oromoo. Keep {placeholders}.
   Dish, modifier and station names live in catalog.ts.
   Have a native speaker on the kitchen team review these before go-live.
   ========================================================= */

type Entry = { am: string; om: string };

export const UI_STRINGS: Record<string, Entry> = {
  /* header */
  "Kitchen Display": { am: "የኩሽና ማሳያ", om: "Agarsiisa Kushinaa" },
  /* sign-in (live mode) */
  Username: { am: "የተጠቃሚ ስም", om: "Maqaa fayyadamaa" },
  Password: { am: "የይለፍ ቃል", om: "Jecha icciitii" },
  "Sign in": { am: "ግባ", om: "Seeni" },
  "Wrong username or password": { am: "የተጠቃሚ ስም ወይም የይለፍ ቃል ተሳስቷል", om: "Maqaan fayyadamaa ykn jechi icciitii dogoggora" },
  "Cannot reach the server. Try again in a minute.": { am: "አገልጋዩን ማግኘት አልተቻለም። ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ።", om: "Sarvarii argachuu hin dandeenye. Daqiiqaa tokko booda irra deebi'ii yaali." },
  "Bole Branch": { am: "ቦሌ ቅርንጫፍ", om: "Damee Boolee" },
  Stations: { am: "ክፍሎች", om: "Kutaalee" },
  "All stations": { am: "ሁሉም ክፍሎች", om: "Kutaalee hunda" },
  "Order type": { am: "የትዕዛዝ ዓይነት", om: "Gosa ajajaa" },
  All: { am: "ሁሉም", om: "Hunda" },
  "Dine-in": { am: "እዚሁ", om: "Asumatti" },
  Takeout: { am: "ለመውሰድ", om: "Fudhatanii deemuu" },
  Language: { am: "ቋንቋ", om: "Afaan" },
  "Sound on": { am: "ድምፅ በርቷል", om: "Sagaleen banaa dha" },
  "Sound off": { am: "ድምፅ ጠፍቷል", om: "Sagaleen cufaa dha" },
  "Switch to light mode": { am: "ወደ ብርሃን ገጽታ ቀይር", om: "Gara bifa ifaatti jijjiiri" },
  "Switch to dark mode": { am: "ወደ ጨለማ ገጽታ ቀይር", om: "Gara bifa dukkanaatti jijjiiri" },
  "Full screen": { am: "ሙሉ ስክሪን", om: "Guutuu iskiriinii" },
  "Recall last picked-up order": { am: "የተወሰደውን የመጨረሻ ትዕዛዝ መልስ", om: "Ajaja dhumaa fudhatame deebisi" },
  Recall: { am: "መልስ", om: "Deebisi" },
  Late: { am: "የዘገዩ", om: "Kan turan" },
  "Avg prep": { am: "አማካይ ዝግጅት", om: "Qophii giddugaleessaa" },
  "Tap anywhere to turn on order sounds": { am: "የትዕዛዝ ድምፅ ለማብራት የትም ቦታ ይንኩ", om: "Sagalee ajajaa banuuf bakka kamiyyuu tuqi" },
  "Demo feed": { am: "የሙከራ ምንጭ", om: "Madda yaalii" },

  /* connection */
  Live: { am: "ቀጥታ", om: "Kallattii" },
  Connecting: { am: "በመገናኘት ላይ", om: "Walqunnamaa jira" },
  Reconnecting: { am: "እንደገና በመገናኘት ላይ", om: "Irra deebiin walqunnamaa jira" },
  Offline: { am: "ግንኙነት የለም", om: "Walqunnamtiin hin jiru" },
  "Connection lost. Showing the last known orders; changes will be retried.": {
    am: "ግንኙነት ተቋርጧል። የመጨረሻዎቹ ትዕዛዞች እየታዩ ነው፤ ለውጦች እንደገና ይሞከራሉ።",
    om: "Walqunnamtiin cite. Ajajoota dhumaa beekaman agarsiisaa jira; jijjiiramni irra deebiin yaalama.",
  },

  /* columns & statuses */
  Pending: { am: "በመጠባበቅ ላይ", om: "Eegaa jira" },
  Preparing: { am: "በዝግጅት ላይ", om: "Qophaa'aa jira" },
  Ready: { am: "ዝግጁ", om: "Qophaa'eera" },
  "New orders from the sales counter": { am: "ከሽያጭ ቆጣሪ የመጡ አዲስ ትዕዛዞች", om: "Ajajoota haaraa kaawwaa gurgurtaa irraa" },
  "Being cooked now": { am: "አሁን እየተዘጋጁ ያሉ", om: "Amma qophaa'aa jiran" },
  "Waiting for pickup": { am: "እስኪወሰዱ በመጠበቅ ላይ", om: "Fudhatamuu eegaa jiran" },
  "No new orders": { am: "አዲስ ትዕዛዝ የለም", om: "Ajajni haaraan hin jiru" },
  "Nothing cooking": { am: "እየተዘጋጀ ያለ የለም", om: "Wanti qophaa'aa jiru hin jiru" },
  "Nothing waiting": { am: "የሚጠብቅ የለም", om: "Wanti eegaa jiru hin jiru" },

  /* ticket */
  "Table {n}": { am: "ጠረጴዛ {n}", om: "Minjaala {n}" },
  NEW: { am: "አዲስ", om: "HAARAA" },
  "Placed {time}": { am: "የገባው {time}", om: "Kan galfame {time}" },
  "Waiter {name}": { am: "አስተናጋጅ {name}", om: "Tajaajilaa {name}" },
  "Prep time {time}": { am: "የዝግጅት ጊዜ {time}", om: "Yeroo qophii {time}" },
  "Waiting {time}": { am: "የጠበቀው {time}", om: "Eeggate {time}" },
  "+{n} more at other stations": { am: "+{n} በሌሎች ክፍሎች", om: "+{n} kutaalee biroo irratti" },
  "{done} of {total} done": { am: "{total} ውስጥ {done} ተጠናቀዋል", om: "{total} keessaa {done} xumurame" },
  "All items done": { am: "ሁሉም ተጠናቀዋል", om: "Hundi xumurameera" },
  "Tap a dish to mark it done": { am: "ምግቡን እንደተጠናቀቀ ለማመልከት ይንኩ", om: "Xumuramuu isaa agarsiisuuf nyaata tuqi" },
  Note: { am: "ማሳሰቢያ", om: "Yaadannoo" },
  "Elapsed time": { am: "ያለፈ ጊዜ", om: "Yeroo darbe" },
  "Elapsed time {time}, {level}": { am: "ያለፈ ጊዜ {time}፣ {level}", om: "Yeroo darbe {time}, {level}" },
  "on time": { am: "በሰዓቱ", om: "yeroo isaatti" },
  "getting late": { am: "እየዘገየ ነው", om: "turaa jira" },
  "late, urgent": { am: "ዘግይቷል፣ አስቸኳይ", om: "tureera, ariifachiisaa" },

  /* actions */
  Start: { am: "ጀምር", om: "Jalqabi" },
  "Mark ready": { am: "ዝግጁ ነው", om: "Qophaa'eera jedhi" },
  "Picked up": { am: "ተወስዷል", om: "Fudhatameera" },
  Back: { am: "ተመለስ", om: "Duubatti" },
  "Move back to {status}": { am: "ወደ {status} መልስ", om: "Gara {status}tti deebisi" },
  "Waiting for {stations}": { am: "{stations}ን በመጠበቅ ላይ", om: "{stations} eegaa jira" },
  Undo: { am: "ቀልብስ", om: "Haqi" },

  /* toasts & alerts */
  "New order {no}": { am: "አዲስ ትዕዛዝ {no}", om: "Ajaja haaraa {no}" },
  "{n} new orders": { am: "{n} አዲስ ትዕዛዞች", om: "Ajajoota haaraa {n}" },
  "{no} is being prepared": { am: "{no} እየተዘጋጀ ነው", om: "{no} qophaa'aa jira" },
  "{no} is ready for pickup": { am: "{no} ለመወሰድ ዝግጁ ነው", om: "{no} fudhatamuuf qophaa'eera" },
  "{no} picked up": { am: "{no} ተወስዷል", om: "{no} fudhatameera" },
  "{no} moved back to {status}": { am: "{no} ወደ {status} ተመልሷል", om: "{no} gara {status}tti deebi'eera" },
  "{no} recalled": { am: "{no} ተመልሷል", om: "{no} deebi'eera" },
  "Could not save. The change was undone; please try again.": {
    am: "ማስቀመጥ አልተቻለም። ለውጡ ተቀልብሷል፤ እባክዎ እንደገና ይሞክሩ።",
    om: "Olkaa'uun hin danda'amne. Jijjiiramni haqameera; maaloo irra deebi'ii yaali.",
  },
  "Nothing to recall": { am: "የሚመለስ ትዕዛዝ የለም", om: "Ajajni deebi'u hin jiru" },
};
