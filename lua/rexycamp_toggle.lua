-- install.sh writes this code under lines that set REXYCAMP_BIN, BASECAMP_BIN, REX_BIN and CLAUDE_BIN.

local PLACEMENTS = { split = true, zoomed = true, tab = true, overlay = true }
local SPLIT_DIRECTIONS = { right = "horizontal", down = "vertical" }
local TERMINAL = "com.superlogical.terminal"
local PANE_LABEL = "rexycamp"
local DEFAULT_KEY = "cmd+b"

local function must(result, call_error)
  if call_error ~= nil then error(call_error, 0) end
  return result
end

local function process_of(block_id)
  return must(rex.block.call(TERMINAL, "process", { block_id = block_id }))
end

local function runs_rexycamp(block_id)
  local process = process_of(block_id)
  if (process.foreground or {}).name == PANE_LABEL then return true end
  for _, ancestor in ipairs(process.ancestors or {}) do
    if ancestor.name == PANE_LABEL then return true end
  end
  return false
end

local function working_directory(block_id)
  local process = process_of(block_id)
  local directory = (process.foreground or {}).cwd
  if directory then return directory end
  for _, ancestor in ipairs(process.ancestors or {}) do
    if ancestor.cwd then return ancestor.cwd end
  end
  return nil
end

local function window_of(blocks, block_id)
  for _, block in ipairs(blocks) do
    if block.block_id == block_id then return block.window_id end
  end
  return nil
end

local function open_rexycamp_panes(blocks, window_id)
  local pane_ids = {}
  for _, block in ipairs(blocks) do
    local in_window = window_id == nil or block.window_id == window_id
    if block.creator_name == TERMINAL and in_window
      and (block.label == PANE_LABEL or runs_rexycamp(block.block_id)) then
      table.insert(pane_ids, block.block_id)
    end
  end
  return pane_ids
end

-- Without this check a missing binary closes the new pane before its error shows.
local function check_rexycamp_runs()
  local result, exec_error = rex.exec({ REXYCAMP_BIN, "--version" }, { timeout = 5 })
  if result == nil then error("cannot run " .. REXYCAMP_BIN .. ": " .. tostring(exec_error), 0) end
  if not result.ok then error((result.stderr:gsub("%s+$", "")), 0) end
end

local function open_rexycamp(focused_block_id, window_id, placement, direction, ratio, columns)
  local pane = rex.layout.block{
    flavor = TERMINAL .. ".shell",
    label = PANE_LABEL,
    options = {
      command = {
        "/usr/bin/env",
        "REXYCAMP_BASECAMP_BIN=" .. BASECAMP_BIN,
        "REXYCAMP_REX_BIN=" .. REX_BIN,
        "REXYCAMP_CLAUDE_BIN=" .. CLAUDE_BIN,
        "REXYCAMP_COLUMNS=" .. table.concat(columns, "\n"),
        REXYCAMP_BIN,
      },
      cwd = focused_block_id and working_directory(focused_block_id),
    },
  }
  if placement == "tab" then
    return must(rex.session.new_window{ window_label = PANE_LABEL, layout = pane })
  elseif placement == "overlay" then
    return must(rex.session.new_layer{
      window_id = window_id,
      bounds = { 0.04, 0.04, 0.92, 0.92 },
      layout = pane,
      focus = true,
    })
  end
  local split = must(rex.session.new_split{
    anchor_id = focused_block_id,
    direction = SPLIT_DIRECTIONS[direction],
    side = "after",
    ratio = 1 - ratio,
    focus = true,
    layout = pane,
  })
  if placement == "zoomed" then
    must(rex.session.zoom_block{ block_id = split.block_ids[1], zoom = true })
  end
  return split
end

return function(settings)
  if type(settings) ~= "table" then
    error("config: settings must be a table, as in: local settings = { }", 0)
  end
  local key = settings.key
  if key == nil then key = DEFAULT_KEY end
  local default_placement = settings.placement or "overlay"
  local direction = settings.direction or "right"
  local ratio = settings.ratio or 0.5
  if not PLACEMENTS[default_placement] then
    error("config: unknown placement " .. tostring(default_placement)
      .. "; use split, zoomed, tab, or overlay", 0)
  end
  if not SPLIT_DIRECTIONS[direction] then
    error("config: unknown direction " .. tostring(direction) .. "; use right or down", 0)
  end
  local columns = settings.columns or {}
  if type(columns) ~= "table" then
    error("config: columns must be a list of column titles, as in: columns = { \"Done\" }", 0)
  end
  for _, column_title in ipairs(columns) do
    if type(column_title) ~= "string" then error("config: every column must be a title in quotes", 0) end
  end
  if type(ratio) ~= "number" or ratio <= 0 or ratio >= 1 then
    error("config: ratio must be a number between 0 and 1", 0)
  end

  rex.action{
    name = "rexycamp_toggle",
    title = "Toggle RexyCamp",
    description = "Open your Basecamp assignments in the focused pane's directory, or close them",
    category = "RexyCamp",
    keywords = "basecamp rexycamp assignments cards todos",
    args = { placement = "string?" },
    run = function(ctx, args)
      local placement = args.placement or default_placement
      if not PLACEMENTS[placement] then
        error("unknown placement " .. tostring(placement)
          .. "; use split, zoomed, tab, or overlay", 0)
      end
      local blocks = must(rex.session.list_blocks{}).blocks or {}
      local window_id = window_of(blocks, ctx.block_id)
      local open_pane_ids = open_rexycamp_panes(blocks, window_id)
      if #open_pane_ids == 0 then
        check_rexycamp_runs()
        return open_rexycamp(ctx.block_id, window_id, placement, direction, ratio, columns)
      end
      for _, pane_id in ipairs(open_pane_ids) do
        must(rex.call("block.close", { session_id = ctx.session_id, block_id = pane_id }))
      end
      return { closed = open_pane_ids }
    end,
  }
  if key then rex.bind(key, "rexycamp_toggle") end
end
