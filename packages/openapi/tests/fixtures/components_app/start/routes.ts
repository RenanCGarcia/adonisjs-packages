import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router.get('billing', [controllers.Limits, 'billing'])
router.get('storage', [controllers.Limits, 'storage'])
router.get('quota', [controllers.Limits, 'quota'])
router.get('frozen', [controllers.Limits, 'frozen'])
