# Family Hub

A wall/kitchen tablet dashboard for the house, in `ui/ui-family.yaml`. It sits first in the sidebar and leaves the other dashboards untouched. Views live in `ui/views/family/`.

| View | What it shows |
|---|---|
| Home | Clock, who is home, weather, agenda, chores, shopping list, server summary |
| Calendar | Month grid plus week agenda |
| Chores | A checklist per person, plus the recurring house chores (existing `chore_row` groups) |
| Lists | Shopping list, family to-do, meal plan |
| House | Schematic ground and first floor plans with light toggles and temperatures |
| Server | Docker host stats for 192.168.86.27 via Glances |

No new HACS cards are needed beyond what `lovelace-resources.yaml` already loads (layout-card, button-card, auto-entities, mushroom, card-mod).

## Setup

1. **Copy the files** into your Home Assistant config folder (`/config` on HA OS), without overwriting anything:
   ```bash
   git clone --depth 1 -b ccr-70269264-28l28e https://github.com/mjj04/hass-config-public-mj /tmp/hub
   mkdir -p /config/ui /config/www && cp -rn /tmp/hub/ui/. /config/ui/ && cp -rn /tmp/hub/www/family /config/www/
   ```
   `www/family/` serves as `/local/family/`.
2. **Install the frontend cards** from HACS: button-card, layout-card, auto-entities, mushroom and card-mod. If you manage resources by hand, `lovelace-resources.yaml` has the URLs.
3. **Add `family_server_glances_url` to `secrets.yaml`** (see Server below). The dashboard will not load without it.
4. **Register only this dashboard** in `configuration.yaml`. Do not include `lovelace-dashboards.yaml`, because it also registers the original personal dashboards.
   ```yaml
   lovelace:
     dashboards:
       ui-family:
         mode: yaml
         title: Family Hub
         icon: mdi:home-heart
         show_in_sidebar: true
         filename: ui/ui-family.yaml
   ```
5. **Restart Home Assistant**, then open `/ui-family/home`. Later edits to the dashboard files only need a browser refresh.
6. Create the entities below, or edit the placeholder ids in the views.

The House chores column on the Chores view uses the original chore setup (`config/chores.yaml`, `config/groups/chores.yaml` and their `input_*` helpers). If you have not installed those, delete that column.

### Entities to create or rename

| Used in | Entity | How to get it |
|---|---|---|
| Home, Calendar | `calendar.family` | Any shared calendar (Google, CalDAV, Local Calendar). Rename the id in the views, or add more calendars to each `entities:` list. |
| Home | `weather.home` | Your weather integration (Met Office or Met.no for the UK). |
| Home, Chores | `todo.chores_<name>` | One Local To-do list per person named `Chores <name>`. Each one gets its own card automatically. |
| Home, Lists | `todo.shopping_list` | Built-in Shopping List integration. |
| Lists | `todo.family_to_do` | Local To-do list named `Family To-do`. |
| Lists | `calendar.meal_plan` | Local Calendar named `Meal Plan`, one all-day event per dinner. |
| Home | `person.*` | Settings > People. Tiles appear automatically. |
| Server | `sensor.homeserver_*` | See below. |

Optional: add the Holiday integration (United Kingdom) and list its calendar next to `calendar.family` to show bank holidays.

### House view entities

The floor plans are redrawn from the listing floor plan, with the room names and metric sizes. They are schematic, not to scale. Each room has a light toggle and, for indoor rooms, a temperature. Replace the placeholder ids in `ui/views/family/house.yaml`, or delete any element you do not have.

| Floor | Room | Light | Temperature |
|---|---|---|---|
| Ground | Garden | `light.garden` | |
| Ground | Sitting / Dining Room | `light.sitting_dining` | `sensor.sitting_dining_temperature` |
| Ground | Kitchen | `light.kitchen` | `sensor.kitchen_temperature` |
| Ground | Hall | `light.hall` | |
| First | Bedroom 1 (front, bay) | `light.bedroom_1` | `sensor.bedroom_1_temperature` |
| First | Bedroom 2 (rear) | `light.bedroom_2` | `sensor.bedroom_2_temperature` |
| First | Bedroom 3 | `light.bedroom_3` | `sensor.bedroom_3_temperature` |
| First | Landing | `light.landing` | |
| First | Bathroom | `light.bathroom` | `sensor.bathroom_temperature` |

A room missing its entity shows an error tile for that one element only.

### Server (192.168.86.27)

1. On the Docker host run Glances in web mode, for example `docker run -d --name glances --restart unless-stopped -p 61208:61208 -e GLANCES_OPT="-w" -v /var/run/docker.sock:/var/run/docker.sock:ro --pid host nicolargo/glances:latest-full`.
2. Add the **Glances** integration in HA with host `192.168.86.27`, port `61208`, and name it **homeserver**. Entities then match `sensor.homeserver_*`.
3. Add this to `secrets.yaml` for the embedded Glances page:
   ```yaml
   family_server_glances_url: http://192.168.86.27:61208
   ```
   Browsers block `http` iframes inside an `https` HA, so use a reverse proxy or open the Glances page in its own tab if the frame stays blank.

The Server view lists sensors whose id contains `container` or `docker` under Containers. Whether Glances exposes per-container sensors depends on your HA and Glances versions, and I have not verified the exact ids, so the embedded Glances page is the reliable per-container view.

The Docker socket mount above is read-only, but anyone who can reach port 61208 can read container details. Keep it on the LAN.

## Wall tablet tips

- The top navigation bar is part of the dashboard. Install `kiosk-mode` from HACS (it is already commented out in `lovelace-resources.yaml`) to hide the stock header and sidebar.
- The clock uses 24-hour time and day-month dates. Change the `strftime` format in `ui/views/family/home.yaml` for 12-hour time.
- Layouts use CSS grids and reflow to one or two columns on portrait tablets and phones.
