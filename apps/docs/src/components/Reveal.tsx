import { motion, type Variants } from "motion/react";

const variants: Variants = {
	hidden: { opacity: 0, y: 14 },
	visible: { opacity: 1, y: 0 },
};

export default function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
	return (
		<motion.div
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, margin: "-80px" }}
			variants={variants}
			transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
		>
			{children}
		</motion.div>
	);
}
