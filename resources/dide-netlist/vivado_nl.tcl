# vivado_nl.tcl
# Vivado RTL netlist -> JSON（独立 batch 进程用）
# Usage:
#   vivado -mode batch -source vivado_nl.tcl -tclargs <device> <top> <manifest> <json>
# manifest: 每行一个源文件路径（Verilog/SV / 黑盒 stub）

set device [lindex $argv 0]
set top    [lindex $argv 1]
set manifest [lindex $argv 2]
set json   [lindex $argv 3]

proc qstr {s} {
    set s [string map {"\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\t" "\\t"} $s]
    return "\"$s\""
}

create_project nl_proj . -part $device -force

set f [open $manifest r]
while {[gets $f line] >= 0} {
    set line [string trim $line]
    if {$line ne ""} {
        add_files [list $line]
    }
}
close $f

set_property top $top [current_fileset]
update_compile_order -fileset sources_1 -quiet

synth_design -rtl -name rtl_1 -top $top

set fd [open $json w]
fconfigure $fd -encoding utf-8

# ===== ports =====
set port_items {}
foreach p [lsort [get_ports -quiet]] {
    set dir [get_property DIRECTION $p]
    set width 1
    if {[get_property LEFT $p] ne ""} {
        set width [expr {abs([get_property LEFT $p] - [get_property RIGHT $p]) + 1}]
    }
    lappend port_items "{\"name\":[qstr $p],\"dir\":[qstr $dir],\"width\":$width}"
}

# ===== cells =====
set cell_items {}
foreach c [lsort [get_cells -hierarchical -quiet]] {
    set nm [get_property NAME $c]
    set ref [get_property REF_NAME $c]
    set box [get_property IS_PRIMITIVE $c]
    lappend cell_items "{\"name\":[qstr $nm],\"type\":[qstr $ref],\"primitive\":$box}"
}

# ===== nets =====
set net_items {}
foreach n [lsort [get_nets -hierarchical -quiet]] {
    set pins [lsort [get_pins -quiet -of_objects [get_nets $n]]]
    set pin_items {}
    foreach pin $pins {
        set cell [get_property NAME [get_cells -quiet -of_objects [get_pins $pin]]]
        set dir [get_property DIRECTION $pin]
        lappend pin_items "{\"pin\":[qstr $pin],\"cell\":[qstr $cell],\"dir\":[qstr $dir]}"
    }
    set ports [lsort [get_ports -quiet -of_objects [get_nets $n]]]
    set pn {}
    foreach p $ports { lappend pn [qstr $p] }
    lappend net_items "{\"name\":[qstr $n],\"pins\":\[[join $pin_items ,]\],\"ports\":\[[join $pn ,]\]}"
}

puts $fd "{\"top\":[qstr $top],\"ports\":\[[join $port_items ,]\],\"cells\":\[[join $cell_items ,]\],\"nets\":\[[join $net_items ,]\]}"
close $fd
puts "NL_OK"
