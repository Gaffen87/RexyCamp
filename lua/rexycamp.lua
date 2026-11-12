-- Settings of RexyCamp. install.sh wrote this file and never overwrites it.
-- To change a setting, edit it, then run "rex config reload".
local settings = {
  -- key = "cmd+b", -- the key of the toggle, or false for none
  -- placement = "overlay", -- overlay, split, zoomed, or tab
  -- direction = "right", -- of split and zoomed: right or down
  -- ratio = 0.5, -- the share of the split that RexyCamp gets
  -- columns = { "Triage", "In progress", "Done" }, -- the columns to show and move to; all when unset
}

local loaded, load_error = pcall(function() require("rexycamp_toggle")(settings) end)
if not loaded then
  rex.action{ name = "rexycamp_toggle", title = "Toggle RexyCamp",
    run = function() error("RexyCamp: " .. tostring(load_error), 0) end }
  local key = type(settings) == "table" and settings.key
  if key == nil then key = "cmd+b" end
  if key then rex.bind(key, "rexycamp_toggle") end
end
