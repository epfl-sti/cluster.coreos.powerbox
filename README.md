# cluster.coreos.powerbox: access local privileged services in EPFL-STI clusters

This is **experimental, work-in-progress** software.

## Design Notes

+ `/run/power` is where power is stored and shared
+ Power is the ability to cause things. In the epfl-sti/cluster.* security model,
  power is controlled under principle of least authority (POLA).
  + You start out with as little power as practically possible
  + If you need more, you don't just grab power; you ask nicely for it, and the
    **powerbox** hands it out to you (after checking access, of course)
+ In a cluster, power comes in two flavors: power over things that run on the same
  host; and power to talk on the network. This package deals mainly with the former
  (we plan to rely on [Calico](http://www.projectcalico.org/) for the latter)
+ Local power consists of small, read-only files (e.g. passwords), and
  UNIX domain sockets
+ [Power begets power](http://www.erights.org/elib/capability/overview.html): you
  can ask for more power through UNIX-domain sockets
+ Power is organized in directories; granting power basically consists of mapping
  a directory inside the target's file tree (e.g. using `docker -v`)
