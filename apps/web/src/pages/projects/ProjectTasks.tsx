import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";
import MyTasks from "../tasks/MyTasks";

export default function ProjectTasks() {
  const { id } = useParams();
  const [heading, setHeading] = useState("Project Tasks");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!id) return;
        const res = await api.get(`/projects/${id}`);
        const title = res?.data?.project?.title || res?.data?.title;
        if (active && title) setHeading(`Tasks · ${title}`);
      } catch (_) {
        /* ignore title fetch errors */
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  return <MyTasks initialProjectId={id || undefined} heading={heading} />;
}
