import { createId } from "@/lib/utils";
import type { LineGroup, Person, Region } from "./types";

export function createDemoPeople(regions: Region[], lines: LineGroup[]): Person[] {
  const leaders = ["张明", "李强", "王磊", "陈涛", "周峰"];
  const attendees = ["刘洋", "赵杰", "黄颖", "孙静", "吴迪", "郑凯", "冯玲", "朱航", "韩雪", "曹宁", "许岩", "谢敏", "彭博", "潘晨", "董琼", "袁凯"];

  const rostrumPeople = leaders.map((name, index) => ({
    id: createId("person"),
    name,
    title: index === 0 ? "主持人" : "参会领导",
    priority: index + 1,
    status: "normal" as const,
    areaType: "rostrum" as const,
    regionId: regions[0]?.id,
    lineId: lines[index % Math.max(lines.length, 1)]?.id,
  }));

  const audiencePeople = attendees.map((name, index) => ({
    id: createId("person"),
    name,
    title: "参会人员",
    priority: index + 1,
    status: "normal" as const,
    areaType: "audience" as const,
    regionId: regions[index % Math.max(regions.length, 1)]?.id,
    lineId: lines[index % Math.max(lines.length, 1)]?.id,
  }));

  return [...rostrumPeople, ...audiencePeople];
}
