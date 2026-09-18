export const SOURCE_COLUMN_COUNT = 569;

export type QuestionCode =
  | 'feel_sad'
  | 'feel_lonely'
  | 'feel_confident'
  | 'feel_stressed'
  | 'feel_happy'
  | 'feel_angry'
  | 'friends_happiness'
  | 'bullying_frequency'
  | 'school_belonging'
  | 'school_helps_when_worried'
  | 'school_enjoyment'
  | 'school_welcoming'
  | 'staff_relationship'
  | 'safety_toilets'
  | 'safety_travel'
  | 'safety_lessons'
  | 'safety_outside_lessons'
  | 'healthy_lifestyle_encouragement';

export type Category =
  | 'emotional_wellbeing'
  | 'relationships'
  | 'school_connection'
  | 'safety'
  | 'healthy_lifestyle';

export interface CohortColumn {
  field: string;
  sourceColumn: number;
  itemLabel: string;
}

export interface Question {
  questionCode: QuestionCode;
  sourceColumn: number;
  itemLabel: string;
  category: Category;
  answers: readonly string[];
  adverseAnswers: readonly string[];
}

export const COHORT_COLUMNS: readonly CohortColumn[] = [
  { field: 'source_id', sourceColumn: 1, itemLabel: 'Individaul ID' },
  {
    field: 'school_classification',
    sourceColumn: 2,
    itemLabel: 'school_classification_list',
  },
  {
    field: 'local_authority',
    sourceColumn: 3,
    itemLabel: 'school_local_authority_filter_classification',
  },
  {
    field: 'year_group',
    sourceColumn: 4,
    itemLabel: 'questionnaire_login_year_group_name',
  },
];

const feelingFrequencyAnswers = ['Never', 'Rarely', 'Some days', 'Most days', 'Every day'];
const frequentFeelingAdverse = ['Most days', 'Every day'];
const rareFeelingAdverse = ['Never', 'Rarely'];

const friendHappinessAnswers = ['Very unhappy', 'Unhappy', 'Ok', 'Happy', 'Very happy'];
const unhappyAdverse = ['Very unhappy', 'Unhappy'];

const bullyingFrequencyAnswers = [
  'Not at all',
  'A few times this year',
  'Every month',
  'Every week',
  'Most days',
  'Every day',
];
const frequentBullyingAdverse = ['Every week', 'Most days', 'Every day'];

const schoolConnectionAnswers = [
  'Strongly disagree',
  'Disagree',
  'Not sure',
  'Agree',
  'Strongly agree',
];
const disagreeAdverse = ['Strongly disagree', 'Disagree'];

const safetyAnswers = ['Very unsafe', 'Unsafe', 'Safe', 'Very safe'];
const unsafeAdverse = ['Very unsafe', 'Unsafe'];

const healthyLifestyleAnswers = ['Very poor', 'Poor', 'Ok', 'Good', 'Very good'];
const poorAdverse = ['Very poor', 'Poor'];

export const QUESTIONS: readonly Question[] = [
  {
    questionCode: 'feel_sad',
    sourceColumn: 293,
    itemLabel: 'Sad or upset',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: frequentFeelingAdverse,
  },
  {
    questionCode: 'feel_lonely',
    sourceColumn: 294,
    itemLabel: 'Lonely',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: frequentFeelingAdverse,
  },
  {
    questionCode: 'feel_confident',
    sourceColumn: 295,
    itemLabel: 'Confident',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: rareFeelingAdverse,
  },
  {
    questionCode: 'feel_stressed',
    sourceColumn: 296,
    itemLabel: 'Stressed or anxious',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: frequentFeelingAdverse,
  },
  {
    questionCode: 'feel_happy',
    sourceColumn: 297,
    itemLabel: 'Happy',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: rareFeelingAdverse,
  },
  {
    questionCode: 'feel_angry',
    sourceColumn: 298,
    itemLabel: 'Bad tempered or angry',
    category: 'emotional_wellbeing',
    answers: feelingFrequencyAnswers,
    adverseAnswers: frequentFeelingAdverse,
  },
  {
    questionCode: 'friends_happiness',
    sourceColumn: 303,
    itemLabel: 'How happy do you feel about the number of good friends you have?',
    category: 'relationships',
    answers: friendHappinessAnswers,
    adverseAnswers: unhappyAdverse,
  },
  {
    questionCode: 'bullying_frequency',
    sourceColumn: 304,
    itemLabel: 'In the last 12 months, how often (if at all) have you been bullied in or around school/college?',
    category: 'relationships',
    answers: bullyingFrequencyAnswers,
    adverseAnswers: frequentBullyingAdverse,
  },
  {
    questionCode: 'school_belonging',
    sourceColumn: 400,
    itemLabel: 'I feel like I belong to my school/college community',
    category: 'school_connection',
    answers: schoolConnectionAnswers,
    adverseAnswers: disagreeAdverse,
  },
  {
    questionCode: 'school_helps_when_worried',
    sourceColumn: 401,
    itemLabel: 'My school/college helps me if I am worried or have a problem',
    category: 'school_connection',
    answers: schoolConnectionAnswers,
    adverseAnswers: disagreeAdverse,
  },
  {
    questionCode: 'school_enjoyment',
    sourceColumn: 402,
    itemLabel: 'I enjoy going to school/college',
    category: 'school_connection',
    answers: schoolConnectionAnswers,
    adverseAnswers: disagreeAdverse,
  },
  {
    questionCode: 'school_welcoming',
    sourceColumn: 403,
    itemLabel: 'My school/college is a welcoming and caring place',
    category: 'school_connection',
    answers: schoolConnectionAnswers,
    adverseAnswers: disagreeAdverse,
  },
  {
    questionCode: 'staff_relationship',
    sourceColumn: 406,
    itemLabel: 'I get on well with staff in my school/college',
    category: 'school_connection',
    answers: schoolConnectionAnswers,
    adverseAnswers: disagreeAdverse,
  },
  {
    questionCode: 'safety_toilets',
    sourceColumn: 407,
    itemLabel: 'School/college toilets',
    category: 'safety',
    answers: safetyAnswers,
    adverseAnswers: unsafeAdverse,
  },
  {
    questionCode: 'safety_travel',
    sourceColumn: 408,
    itemLabel: 'Travelling to and from school/college',
    category: 'safety',
    answers: safetyAnswers,
    adverseAnswers: unsafeAdverse,
  },
  {
    questionCode: 'safety_lessons',
    sourceColumn: 409,
    itemLabel: 'During lessons at school/college',
    category: 'safety',
    answers: safetyAnswers,
    adverseAnswers: unsafeAdverse,
  },
  {
    questionCode: 'safety_outside_lessons',
    sourceColumn: 410,
    itemLabel: 'At school/college, not in lessons',
    category: 'safety',
    answers: safetyAnswers,
    adverseAnswers: unsafeAdverse,
  },
  {
    questionCode: 'healthy_lifestyle_encouragement',
    sourceColumn: 530,
    itemLabel: 'How good is your school/college at encouraging you to have a healthy lifestyle?',
    category: 'healthy_lifestyle',
    answers: healthyLifestyleAnswers,
    adverseAnswers: poorAdverse,
  },
];

export function questionByCode(code: string): Question {
  const question = QUESTIONS.find((entry) => entry.questionCode === code);
  if (question === undefined) {
    throw new Error(`Unknown question code: ${code}`);
  }
  return question;
}
